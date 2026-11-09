import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Secret, TOTP } from 'otpauth';
import { expect, skipProbeTest, test } from './fixtures';
import { E2E_ENV } from '../playwright.config';

// A player's progress edited from the panel against the real server (GDD §16.2; M6d-4): a new admin (CLI), in a
// browser of its own, opens a new player's «Progreso», unlocks Vigía for them, repairs their Laboratorio and adds 100
// season points; the player then chooses Vigía in the hangar. Writes e2e_* accounts only. No CSP violations.
const cli = fileURLToPath(new URL('../../server/dist/cli.js', import.meta.url));
const PASS = 'una-clave-larga-e2e';

test('un admin desbloquea una sonda, repara el laboratorio y suma puntos de temporada a un jugador', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const csp: string[] = [];
  const watch = (p: typeof page) =>
    p.on('console', (msg) => {
      if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
    });
  watch(page);

  // The player: a new account with its probe.
  const username = `e2e_${randomBytes(4).toString('hex')}`;
  await page.goto('/galaxy/crear-cuenta');
  await page.getByLabel('Usuario').fill(username);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASS);
  await page.getByLabel('Repite la contraseña').fill(PASS);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await skipProbeTest(page);
  // The probes are managed in the workshop.
  await page.goto('/galaxy/taller');
  const probes = page.getByRole('list', { name: 'Sondas' });
  await expect(probes.getByRole('listitem')).toHaveCount(8);
  await expect(probes.getByRole('listitem').filter({ hasText: 'Vigía' })).toContainText(/Juega|Derrota|Extrae|Alcanza|Elimina/);

  // The admin, in a browser of its own.
  const origin = new URL(page.url()).origin;
  const b = randomBytes(3);
  const adminCtx = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { 'cf-connecting-ip': `10.${b[0]}.${b[1]}.${b[2]}` } });
  const admin = await adminCtx.newPage();
  watch(admin);
  const creds = JSON.parse(
    execFileSync('node', [cli, 'create-admin', `e2e_adm_${randomBytes(4).toString('hex')}`, '--role', 'admin', '--json'], { env: { ...process.env, ...E2E_ENV }, encoding: 'utf8' }).trim().split('\n').at(-1)!,
  ) as { username: string; password: string; totpSecret: string };
  await admin.goto('/galaxy/entrar');
  await admin.getByLabel('Usuario').fill(creds.username);
  await admin.getByLabel('Contraseña', { exact: true }).fill(creds.password);
  await admin.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(admin).toHaveURL(/\/galaxy\/verificar$/);
  await admin.getByLabel('Código').fill(TOTP.generate({ secret: Secret.fromBase32(creds.totpSecret), algorithm: 'SHA1', digits: 6, period: 30 }));
  await admin.getByRole('button', { name: 'Verificar' }).click();
  await expect(admin.locator('.hud').getByText(creds.username, { exact: true })).toBeVisible();

  await admin.goto(`/galaxy/admin/jugadores/${username}`);
  await admin.getByRole('tab', { name: 'Progreso' }).click();
  const apply = async (button: string, fill: Record<string, string>, reason: string) => {
    await admin.getByRole('button', { name: button, exact: true }).click();
    const dialog = admin.getByRole('dialog', { name: button });
    for (const [label, value] of Object.entries(fill)) await dialog.getByLabel(label, { exact: true }).fill(value);
    await dialog.getByLabel('Motivo').fill(reason);
    await dialog.getByRole('button', { name: 'Aplicar' }).click();
    await expect(dialog).toBeHidden();
    await expect(admin.getByRole('status').filter({ hasText: 'Hecho. Queda en la auditoría' })).toBeVisible();
  };

  // Unlock Vigía: no password (it gives, it does not take away).
  await apply('Desbloquear Vigía', {}, 'Premio del torneo del e2e');
  const probeTable = admin.getByRole('table', { name: 'Sondas' });
  await expect(probeTable.getByRole('row').filter({ hasText: 'Vigía' })).toContainText('Desbloqueada por un admin');
  // Repair the Laboratorio (0 → 1).
  await apply('Cambiar el nivel de Laboratorio', { Nivel: '1' }, 'Reparación del e2e');
  await expect(admin.getByRole('table', { name: 'Máquinas de la estación' }).getByRole('row').filter({ hasText: 'Laboratorio' })).toContainText('1 de 1');
  // 100 season points.
  await apply('Ajustar puntos de temporada', { Puntos: '100' }, 'Puntos del torneo del e2e');
  await expect(admin.getByText(/: 100 puntos, de ellos 100 de ajustes del panel$/)).toBeVisible();

  // The player chooses Vigía now.
  await page.reload();
  await probes.getByRole('button', { name: 'Vigía' }).click();
  await expect(probes.getByRole('button', { name: 'Vigía' })).toHaveAttribute('aria-pressed', 'true');

  await adminCtx.close();
  expect(csp).toEqual([]);
});
