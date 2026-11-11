import { randomBytes } from 'node:crypto';
import { expect, skipProbeTest, test } from './fixtures';

// The resource shop against the real server (shop and lab plan, F5): without Stripe's keys (as in CI and locally) it
// is closed, says so, offers nothing, and loads nothing of Stripe (no CSP violation either). Writes e2e_* accounts only.
const PASS = 'una-clave-larga-e2e';

test('sin las claves de Stripe la tienda dice que está cerrada y no carga nada de Stripe', async ({ page }) => {
  const csp: string[] = [];
  const stripe: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  page.on('request', (req) => {
    if (/stripe\.com/.test(req.url())) stripe.push(req.url());
  });
  const username = `e2e_${randomBytes(4).toString('hex')}`;
  await page.goto('/galaxy/crear-cuenta');
  await page.getByLabel('Usuario').fill(username);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASS);
  await page.getByLabel('Repite la contraseña').fill(PASS);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await skipProbeTest(page);
  await expect(page.locator('.hud').getByText(username, { exact: true })).toBeVisible();

  await page.goto('/galaxy/tienda');
  await expect(page.getByRole('heading', { name: 'Tienda', level: 1 })).toBeVisible();
  await expect(page.getByText('La tienda está cerrada ahora mismo')).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  // The page never grows sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(stripe).toEqual([]);
  expect(csp).toEqual([]);
});
