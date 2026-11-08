import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Secret, TOTP } from 'otpauth';
import { type Page, expect, skipProbeTest, test } from './fixtures';
import { E2E_ENV } from '../playwright.config';

// The admin panel against the real server (GDD §16.1, §16.2; M6a): a new admin (CLI) signs in with TOTP and opens the
// panel from the top bar's shield; finds a new player by name, gives them coins with a reason, bans them with the
// password and sees «Baneado»; the player's session is gone; the audit lists both changes and exports them as CSV.
// No CSP violations. Writes e2e_* accounts only.
const cli = fileURLToPath(new URL('../../server/dist/cli.js', import.meta.url));

function watchCsp(page: Page): string[] {
  const csp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  return csp;
}

test('un admin encuentra a un jugador, le da monedas, lo banea y lo ve en la auditoría', async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  // The player, in its own browser.
  const b = randomBytes(3);
  const other = await browser.newContext({ baseURL, viewport: { width: 1600, height: 900 }, extraHTTPHeaders: { 'cf-connecting-ip': `10.${b[0]}.${b[1]}.${b[2]}` } });
  const playerPage = await other.newPage();
  const name = `e2e_${randomBytes(4).toString('hex')}`;
  await playerPage.goto('/galaxy/crear-cuenta');
  await playerPage.getByLabel('Usuario').fill(name);
  await playerPage.getByLabel('Contraseña', { exact: true }).fill('una-clave-larga-e2e');
  await playerPage.getByLabel('Repite la contraseña').fill('una-clave-larga-e2e');
  await playerPage.getByRole('button', { name: 'Crear cuenta' }).click();
  await skipProbeTest(playerPage);

  // A new admin signs in with its code.
  const adminName = `e2e_adm_${randomBytes(4).toString('hex')}`;
  const creds = JSON.parse(
    execFileSync('node', [cli, 'create-admin', adminName, '--role', 'admin', '--json'], { env: { ...process.env, ...E2E_ENV }, encoding: 'utf8' }).trim().split('\n').at(-1)!,
  ) as { username: string; password: string; totpSecret: string };
  const csp = watchCsp(page);
  await page.goto('/galaxy/entrar');
  await page.getByLabel('Usuario').fill(creds.username);
  await page.getByLabel('Contraseña', { exact: true }).fill(creds.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/galaxy\/verificar$/);
  await page.getByLabel('Código').fill(TOTP.generate({ secret: Secret.fromBase32(creds.totpSecret), algorithm: 'SHA1', digits: 6, period: 30 }));
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.locator('.hud').getByText(creds.username, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Administración' }).click();
  await expect(page).toHaveURL(/\/galaxy\/admin\/jugadores$/);

  // Find the player and give them coins.
  await page.getByRole('searchbox', { name: 'Buscar por nombre, IP o clan' }).fill(name);
  await page.getByRole('table').getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await page.getByRole('button', { name: 'Dar o quitar moneda' }).click();
  const wallet = page.getByRole('dialog', { name: 'Dar o quitar moneda' });
  await wallet.getByLabel('Cantidad').fill('500');
  await wallet.getByLabel('Motivo').fill('Compensación de prueba');
  await wallet.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByRole('status')).toHaveText('Hecho. Queda en la auditoría');

  // Ban them, with the password.
  await page.getByRole('button', { name: 'Banear' }).click();
  const ban = page.getByRole('dialog', { name: 'Banear' });
  await ban.getByLabel('Motivo').fill('Prueba de baneo');
  await ban.getByLabel('Tu contraseña').fill(creds.password);
  await ban.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Baneado hasta el', { exact: false })).toBeVisible();
  expect((await playerPage.request.get('/galaxy/api/auth/me')).status()).toBe(401);
  await other.close();

  // The audit lists both, and exports them.
  await page.getByRole('navigation', { name: 'Secciones del panel' }).getByRole('link', { name: 'Auditoría' }).click();
  await page.getByLabel('Quién').fill(creds.username);
  await expect(page.getByRole('cell', { name: 'player.ban' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'player.wallet' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Exportar CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^auditoria-.*\.csv$/);
  expect(csp).toEqual([]);
});
