import { randomBytes } from 'node:crypto';
import { expect, skipProbeTest, test } from './fixtures';

// The deep scan against the real server (GDD §9): a new account gets its welcome signals, sees the odds and the
// guarantee before paying, scans ten, watches the reveal begin, skips to the summary and finds the ten galaxies in
// its collection. Writes e2e_* accounts only.
const PASS = 'una-clave-larga-e2e';

test('una cuenta nueva recibe la bienvenida, escanea 10, ve el resumen y las encuentra en la colección', async ({ page }) => {
  const csp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  const username = `e2e_${randomBytes(4).toString('hex')}`;
  await page.goto('/galaxy/crear-cuenta');
  await page.getByLabel('Usuario').fill(username);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASS);
  await page.getByLabel('Repite la contraseña').fill(PASS);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await skipProbeTest(page);
  await page.getByRole('link', { name: /^Escáner Obtén nuevas galaxias/ }).click();
  await expect(page).toHaveURL(/\/galaxy\/escaner$/);

  await expect(page.getByRole('table', { name: 'Probabilidades del próximo escaneo' })).toBeVisible();
  await expect(page.getByText('Suerte de bienvenida')).toBeVisible();
  await expect(page.getByText(/Legendaria segura en 10 escaneos/)).toBeVisible();
  await expect(page.getByRole('img', { name: '10 señales de galaxia' })).toBeVisible();

  await page.getByRole('button', { name: /Escanear 10.*10 señales/ }).click();
  const stage = page.getByRole('dialog', { name: 'Escaneo de campo profundo' });
  await expect(stage.getByText('1 de 10')).toBeVisible();
  // The first scan resolves the real engine image before Saltar.
  await expect(stage.locator('.crt-image[data-ready="true"]')).toBeAttached({ timeout: 20_000 });
  await stage.getByRole('button', { name: 'Saltar' }).click();
  await expect(stage.getByRole('heading', { name: '10 galaxias nuevas' })).toBeVisible();
  await expect(stage.getByRole('article')).toHaveCount(10);
  await expect(page.getByRole('img', { name: '0 señales de galaxia' })).toBeVisible();

  await expect(stage.getByRole('button', { name: /¡Escanear otras 10!/ })).toBeVisible();
  await stage.getByRole('link', { name: 'Colección' }).click();
  await expect(page).toHaveURL(/\/galaxy\/coleccion$/);
  await expect(page.getByRole('article')).toHaveCount(10);
  // The welcome guarantees a Legendary within the first ten scans.
  await expect(page.getByRole('button', { name: /^Legendaria/ })).not.toContainText(/\b0\b/);
  expect(csp).toEqual([]);
});
