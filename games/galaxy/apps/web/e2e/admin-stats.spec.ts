import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Secret, TOTP } from 'otpauth';
import { expect, test } from './fixtures';
import { E2E_ENV } from '../playwright.config';

// Live statistics against the real server (GDD §16.6; M6d-2): a new admin (CLI) opens Estadísticas from the side nav,
// sees the tiles and the runs chart, switches to the last 7 days (7 bars) and downloads the runs CSV. Reading only. No
// CSP violations.
const cli = fileURLToPath(new URL('../../server/dist/cli.js', import.meta.url));

test('un admin mira las estadísticas, cambia a 7 días y descarga un CSV', async ({ page }) => {
  test.setTimeout(120_000);
  const csp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  const creds = JSON.parse(
    execFileSync('node', [cli, 'create-admin', `e2e_adm_${randomBytes(4).toString('hex')}`, '--role', 'admin', '--json'], { env: { ...process.env, ...E2E_ENV }, encoding: 'utf8' }).trim().split('\n').at(-1)!,
  ) as { username: string; password: string; totpSecret: string };
  await page.goto('/galaxy/entrar');
  await page.getByLabel('Usuario').fill(creds.username);
  await page.getByLabel('Contraseña', { exact: true }).fill(creds.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/galaxy\/verificar$/);
  await page.getByLabel('Código').fill(TOTP.generate({ secret: Secret.fromBase32(creds.totpSecret), algorithm: 'SHA1', digits: 6, period: 30 }));
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.locator('.hud').getByText(creds.username, { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Administración' }).click();
  await page.getByRole('navigation', { name: 'Secciones del panel' }).getByRole('link', { name: 'Estadísticas' }).click();
  await expect(page).toHaveURL(/\/galaxy\/admin\/estadisticas$/);
  // This admin's own session is connected now.
  const online = page.getByRole('group', { name: 'Conectados ahora' });
  await expect(online).toBeVisible();
  expect(Number((await online.locator('.stat-value').textContent())!.replace(/\D/g, ''))).toBeGreaterThanOrEqual(1);
  const chart = page.getByRole('img', { name: 'Partidas empezadas en cada tramo del periodo' });
  await expect(chart.locator('[data-bar]')).toHaveCount(24);

  await page.getByRole('button', { name: 'Últimos 7 días' }).click();
  await expect(chart.locator('[data-bar]')).toHaveCount(7);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Exportar CSV' }).first().click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^estadisticas-runs-7d-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(csp).toEqual([]);
});
