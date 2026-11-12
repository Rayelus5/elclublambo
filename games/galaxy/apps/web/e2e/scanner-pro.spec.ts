import { randomBytes } from 'node:crypto';
import { expect, skipProbeTest, test } from './fixtures';

// The pro reveal against the real server (plan «escáner pro», part B): with «Presentación pro del escáner» on, a scan
// of ten closes the bands at once, the cinema (GSAP and three.js, their own chunk) plays, «Saltar» lands on the same
// summary as ever, and nothing breaks the CSP. Writes e2e_* accounts only.
const PASS = 'una-clave-larga-e2e';

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
