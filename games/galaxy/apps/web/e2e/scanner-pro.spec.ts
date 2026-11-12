import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { E2E_ENV } from '../playwright.config';
import { expect, skipProbeTest, test } from './fixtures';

// The pro reveal against the real server (plan «escáner pro», part B): with «Presentación pro» on, a scan of ten closes
// the bands at once, the cinema (GSAP and three.js, their own chunk) plays, «Saltar» lands on the same summary as ever,
// and nothing breaks the CSP. A fusion of five plays it too, with its ring (plan «fusión pro»). Writes e2e_* accounts
// only.
const PASS = 'una-clave-larga-e2e';
const cli = fileURLToPath(new URL('../../server/dist/cli.js', import.meta.url));

test('con la presentación pro, escanear 10 cierra las bandas, juega la cinemática y Saltar lleva al resumen', async ({ page }) => {
  const csp: string[] = [];
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('galaxy.prefs', JSON.stringify({ state: { scannerPro: true, motion: 'system', colorVision: 'none' }, version: 1 })));
  const username = `e2e_${randomBytes(4).toString('hex')}`;
  await page.goto('/galaxy/crear-cuenta');
  await page.getByLabel('Usuario').fill(username);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASS);
  await page.getByLabel('Repite la contraseña').fill(PASS);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await skipProbeTest(page);
  await page.goto('/galaxy/escaner');

  await page.getByRole('button', { name: /Escanear 10.*10 señales/ }).click();
  const stage = page.getByRole('dialog', { name: 'Escaneo de campo profundo' });
  await expect(stage.locator('.pro-root')).toBeAttached();
  await expect(stage.locator('.pro-canvas')).toBeAttached({ timeout: 20_000 });
  await expect(stage.locator('.pro-root')).toHaveAttribute('data-state', 'playing');
  await page.waitForTimeout(800);
  await stage.getByRole('button', { name: 'Saltar' }).click();
  await expect(stage.getByRole('heading', { name: '10 galaxias nuevas' })).toBeVisible({ timeout: 10_000 });
  await expect(stage.getByRole('article')).toHaveCount(10);
  await stage.getByRole('button', { name: 'Cerrar' }).click();
  await expect(stage).toBeHidden();
  expect(csp).toEqual([]);
  expect(errors).toEqual([]);
});

test('con la presentación pro, fusionar cinco comunes juega la cinemática de la fusión y Saltar lleva al resumen', async ({ page, baseURL }) => {
  const csp: string[] = [];
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('galaxy.prefs', JSON.stringify({ state: { scannerPro: true, motion: 'system', colorVision: 'none' }, version: 1 })));
  const username = `e2e_${randomBytes(4).toString('hex')}`;
  await page.goto('/galaxy/crear-cuenta');
  await page.getByLabel('Usuario').fill(username);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASS);
  await page.getByLabel('Repite la contraseña').fill(PASS);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await skipProbeTest(page);
  await expect(page.locator('.hud').getByText(username, { exact: true })).toBeVisible();
  // Forty galaxies (commons enough to fuse five) and the dust it costs.
  const env = { ...process.env, ...E2E_ENV };
  execFileSync('node', [cli, 'grant', username, 'signal', '30', '--reason', 'e2e'], { env });
  execFileSync('node', [cli, 'grant', username, 'dust', '500', '--reason', 'e2e'], { env });
  for (let i = 0; i < 4; i++) {
    const res = await page.request.post('/galaxy/api/gacha/pull', { headers: { origin: baseURL!, 'idempotency-key': randomUUID() }, data: { banner: 'deep-scan', count: 10, pay: 'signal' } });
    expect(res.status()).toBe(200);
  }
  await page.goto('/galaxy/coleccion?tier=common');
  await expect(page.getByRole('article').first()).toBeVisible();
  await page.getByRole('button', { name: 'Fusionar', exact: true }).click();
  const picks = page.getByRole('button', { name: /^Seleccionar / });
  for (let i = 0; i < 5; i++) await picks.nth(i).click();
  await page.getByRole('region', { name: 'Fusionar' }).getByRole('button', { name: 'Fusionar ahora' }).click();

  const stage = page.getByRole('dialog', { name: 'Nueva galaxia' });
  await expect(stage.locator('.pro-root')).toBeAttached();
  await expect(stage.locator('.pro-canvas')).toBeAttached({ timeout: 20_000 });
  await expect(stage.locator('.pro-root')).toHaveAttribute('data-state', 'playing');
  await page.waitForTimeout(800);
  await stage.getByRole('button', { name: 'Saltar' }).click();
  await expect(stage.getByRole('heading', { name: 'Galaxia nueva' })).toBeVisible({ timeout: 10_000 });
  await expect(stage.getByRole('article')).toHaveCount(1);
  await expect(stage.getByRole('article')).toContainText('Poco común');
  await stage.getByRole('button', { name: 'Cerrar' }).click();
  await expect(stage).toBeHidden();
  expect(csp).toEqual([]);
  expect(errors).toEqual([]);
});
