import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Secret, TOTP } from 'otpauth';
import { expect, skipProbeTest, test } from './fixtures';
import { E2E_ENV } from '../playwright.config';

// The run replayer against the real server (GDD §16.2, §16.6; M6d-3): a new player plays a few seconds and abandons;
// a new admin (CLI), in a browser of its own, finds the run in Partidas by the player's name, plays it, checks it
// («Coincide con lo guardado») and marks it as suspicious with a reason. Writes e2e_* accounts only. No CSP violations.
const cli = fileURLToPath(new URL('../../server/dist/cli.js', import.meta.url));
const PASS = 'una-clave-larga-e2e';

test('un admin reproduce la partida de un jugador, la comprueba y la marca', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const csp: string[] = [];
  const watch = (p: typeof page) =>
    p.on('console', (msg) => {
      if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
    });
  watch(page);

  // The player: a new account, a few seconds in the first sector, abandoned from the pause menu.
  const username = `e2e_${randomBytes(4).toString('hex')}`;
  await page.goto('/galaxy/crear-cuenta');
  await page.getByLabel('Usuario').fill(username);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASS);
  await page.getByLabel('Repite la contraseña').fill(PASS);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await skipProbeTest(page);
  await page.getByRole('link', { name: /Jugar/ }).click();
  await expect(page).toHaveURL(/\/galaxy\/incursion$/);
  await page.getByRole('button', { name: 'Lanzar incursión' }).click();
  await expect(page.locator('.arena-canvas')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyW');
  await expect(page.locator('.hud-time')).not.toHaveText('0:00');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Pausa' }).getByRole('button', { name: 'Abandonar incursión' }).click();
  await page.getByRole('alertdialog', { name: 'Abandonar incursión' }).getByRole('button', { name: 'Abandonar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Incursión abandonada' })).toBeVisible({ timeout: 20_000 });

  // The admin, in a browser of its own (its own address too, for the rate limits).
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

  // Partidas, by the player's name: their one run, abandoned.
  await admin.getByRole('link', { name: 'Administración' }).click();
  await admin.getByRole('navigation', { name: 'Secciones del panel' }).getByRole('link', { name: 'Partidas' }).click();
  await expect(admin).toHaveURL(/\/galaxy\/admin\/partidas$/);
  await admin.getByRole('searchbox', { name: 'Jugador' }).fill(username);
  const row = admin.getByRole('row').filter({ hasText: username });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Abandonada');
  await row.getByRole('link', { name: `Ver la partida de ${username}` }).click();

  // The replay: it plays and pauses, and «Comprobar» finds what the server kept.
  await expect(admin.getByRole('heading', { level: 1, name: `Partida de ${username}` })).toBeVisible();
  await admin.getByRole('button', { name: 'Velocidad 2 veces' }).click();
  await admin.getByRole('button', { name: 'Reproducir' }).click();
  await expect(admin.getByRole('button', { name: 'Pausar' })).toBeVisible();
  await expect(admin.locator('.replay-stage .hud-time')).not.toHaveText('0:00', { timeout: 10_000 });
  await admin.getByRole('button', { name: 'Comprobar' }).click();
  await expect(admin.getByText('Coincide con lo guardado', { exact: true })).toBeVisible({ timeout: 30_000 });

  // Marking asks for a reason and says the pay stays.
  await admin.getByRole('button', { name: 'Marcar como sospechosa' }).click();
  const dialog = admin.getByRole('dialog', { name: 'Marcar como sospechosa' });
  await expect(dialog).toContainText('La experiencia y la paga que ya dio no cambian');
  await dialog.getByLabel('Motivo').fill('Revisada en el e2e del reproductor');
  await dialog.getByRole('button', { name: 'Marcar como sospechosa' }).click();
  await expect(admin.getByRole('status').filter({ hasText: 'Marcada como sospechosa' })).toBeVisible();
  await expect(admin.locator('.replay-facts')).toContainText('Sospechosa');
  await expect(admin.getByRole('button', { name: 'Quitar la marca' })).toBeVisible();

  // And it is among the suspicious ones.
  await admin.getByRole('link', { name: 'Todas las partidas' }).click();
  await admin.getByRole('button', { name: 'Solo sospechosas' }).click();
  await admin.getByRole('searchbox', { name: 'Jugador' }).fill(username);
  await expect(admin.getByRole('row').filter({ hasText: username })).toContainText('Sospechosa');

  await adminCtx.close();
  expect(csp).toEqual([]);
});
