import { randomBytes, randomUUID } from 'node:crypto';
import { type Page, expect, skipProbeTest, test } from './fixtures';

// The title screen against the real server (GDD §4): a new account gets the welcome signals, sees them in the top
// bar with the free pull, the season in the right column (M5a) and, after scanning, its galaxies counted in the
// collection's tile. Writes e2e_* accounts only.
const PASS = 'una-clave-larga-e2e';

async function newAccount(page: Page): Promise<string> {
  const username = `e2e_${randomBytes(4).toString('hex')}`;
  await page.goto('/galaxy/crear-cuenta');
  await page.getByLabel('Usuario').fill(username);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASS);
  await page.getByLabel('Repite la contraseña').fill(PASS);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await skipProbeTest(page);
  await expect(page.locator('.hud').getByText(username, { exact: true })).toBeVisible();
  return username;
}

test('una cuenta nueva ve sus señales de bienvenida, la tirada gratis y lo que está en desarrollo', async ({ page }) => {
  const csp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  await newAccount(page);
  await expect(page.getByRole('img', { name: '10 señales de galaxia' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Escáner profundo/ })).toContainText('Tirada gratis');
  await expect(page.getByRole('link', { name: /Colección/ })).toContainText('0 galaxias');
  // M3a: Jugar opens the hangar; M4a: the Estación opens the station.
  await expect(page.getByRole('link', { name: /Jugar/ })).toHaveAttribute('href', '/galaxy/incursion');
  await expect(page.getByRole('link', { name: /^Estación/ })).toHaveAttribute('href', '/galaxy/estacion');
  // M5a: the right column is the season (closed or open, a new account has no place yet) and Ranking leads to it.
  await expect(page.getByRole('complementary', { name: /Temporada|Clasificación/ })).toContainText(/Juega una incursión para entrar en la clasificación|No hay ninguna temporada abierta/);
  await expect(page.getByRole('link', { name: /Ranking/ })).toHaveAttribute('href', '/galaxy/clasificacion');
  expect(csp).toEqual([]);
});

test('tras escanear, el mosaico de la colección cuenta sus galaxias', async ({ page, baseURL }) => {
  await newAccount(page);
  const res = await page.request.post('/galaxy/api/gacha/pull', {
    headers: { origin: baseURL!, 'idempotency-key': randomUUID() },
    data: { banner: 'deep-scan', count: 10, pay: 'signal' },
  });
  expect(res.status()).toBe(200);
  await page.reload();
  await expect(page.getByRole('link', { name: /Colección/ })).toContainText('10 galaxias');
  await expect(page.getByRole('img', { name: '0 señales de galaxia' })).toBeVisible();
});

test('Salir cierra la sesión desde la pantalla de título', async ({ page }) => {
  await newAccount(page);
  await page.getByRole('button', { name: 'Salir', exact: true }).click();
  await expect(page).toHaveURL(/\/galaxy\/entrar$/);
  await page.goto('/galaxy/');
  await expect(page).toHaveURL(/\/galaxy\/entrar$/);
});
