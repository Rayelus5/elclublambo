import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type Page, expect, skipProbeTest, test } from './fixtures';
import { Secret, TOTP } from 'otpauth';
import { ADMIN_FILE } from './state';

const PASS = 'una-clave-larga-e2e';
const entrarButton = (page: Page) => page.getByRole('button', { name: 'Entrar', exact: true });

/** Fails the test on any CSP violation reported in the console. */
function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
  });
  return violations;
}

test('crear cuenta, pantalla de título, salir y volver a entrar con el nombre en mayúsculas', async ({ page }) => {
  const csp = watchCsp(page);
  const username = `e2e_${randomBytes(4).toString('hex')}`;
  await page.goto('/galaxy/crear-cuenta');
  await expect(page.getByRole('heading', { name: 'Únete al ECN' })).toBeVisible();
  await page.getByLabel('Usuario').fill(username);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASS);
  await page.getByLabel('Repite la contraseña').fill(PASS);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await skipProbeTest(page);
  await expect(page.locator('.hud').getByText(username, { exact: true })).toBeVisible();
  // The router writes home as /galaxy; the server redirects that to /galaxy/ on reload. Both are home.
  await expect(page).toHaveURL(/\/galaxy\/?$/);

  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page).toHaveURL(/\/galaxy\/entrar$/);
  await page.getByLabel('Usuario').fill(username.toUpperCase());
  await page.getByLabel('Contraseña', { exact: true }).fill(PASS);
  await entrarButton(page).click();
  await expect(page.locator('.hud').getByText(username, { exact: true })).toBeVisible();
  expect(csp).toEqual([]);
});

test('un admin entra con contraseña y código TOTP y ve su insignia', async ({ page }) => {
  const admin = JSON.parse(readFileSync(ADMIN_FILE, 'utf8')) as { username: string; password: string; totpSecret: string };
  await page.goto('/galaxy/entrar');
  await page.getByLabel('Usuario').fill(admin.username);
  await page.getByLabel('Contraseña', { exact: true }).fill(admin.password);
  await entrarButton(page).click();
  await expect(page).toHaveURL(/\/galaxy\/verificar$/);
  await expect(page.getByRole('heading', { name: 'Confirma que eres tú' })).toBeVisible();
  const code = TOTP.generate({ secret: Secret.fromBase32(admin.totpSecret), algorithm: 'SHA1', digits: 6, period: 30 });
  await page.getByLabel('Código').fill(code);
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.locator('.hud').getByText(admin.username, { exact: true })).toBeVisible();
  await expect(page.getByText('Admin', { exact: true })).toBeVisible();
});

test('sin sesión, la portada lleva a Entrar y no hay bucle (Review Focus 3)', async ({ page }) => {
  let meCalls = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/galaxy/api/auth/me')) meCalls++;
  });
  await page.goto('/galaxy/');
  await expect(page).toHaveURL(/\/galaxy\/entrar$/);
  await expect(page.getByRole('heading', { name: 'Vuelve a tu estación' })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/\/galaxy\/entrar$/);
  expect(meCalls).toBeLessThanOrEqual(2);
});

test('credenciales malas muestran el aviso en el formulario', async ({ page }) => {
  await page.goto('/galaxy/entrar');
  await page.getByLabel('Usuario').fill(`e2e_${randomBytes(4).toString('hex')}`);
  await page.getByLabel('Contraseña', { exact: true }).fill('no-es-esta-clave');
  await entrarButton(page).click();
  await expect(page.getByRole('alert')).toHaveText('Usuario o contraseña incorrectos. Revísalos y vuelve a probar');
});

test.describe('pantalla pequeña', () => {
  // The gate checks the SCREEN (a 1366×768 laptop with browser chrome must get in): shrink both.
  test.use({ viewport: { width: 1024, height: 700 }, screen: { width: 1024, height: 700 } });
  test('muestra el aviso de solo ordenador', async ({ page }) => {
    await page.goto('/galaxy/entrar');
    await expect(page.getByRole('heading', { name: 'Galaxy Survivor se juega en ordenador' })).toBeVisible();
  });
});

test('el documento lleva la CSP estricta del juego', async ({ page }) => {
  const res = await page.goto('/galaxy/entrar');
  expect(res?.headers()['content-security-policy']).toBe(
    "default-src 'self'; script-src 'self' https://js.stripe.com https://*.js.stripe.com; style-src 'self'; img-src 'self' data: blob: https://*.stripe.com; font-src 'self'; connect-src 'self' https://api.stripe.com; frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  );
});
