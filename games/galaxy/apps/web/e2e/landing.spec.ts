import { expect, test } from './fixtures';

// The landing of galaxysurvivor.es against the real server and its CSP (plan «galaxysurvivor.es», PR 4): the home page
// with the owner's title, «Jugar gratis» to the game, the legal pages, the files search engines read, and a real 404.
// Writes nothing.

test('la portada: su título, «Sobrevive a la Estática» y «Jugar gratis» al juego, sin errores de CSP', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  await page.goto('/');
  await expect(page).toHaveTitle('Galaxy Survivor | Roguelite de hordas gratis en el navegador');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sobrevive a la Estática');
  await expect(page.locator('.hero').getByRole('link', { name: 'Jugar gratis' })).toHaveAttribute('href', '/galaxy/crear-cuenta');
  await page.locator('#preguntas').scrollIntoViewIfNeeded();
  await expect(page.getByText('¿Es gratis?')).toBeVisible();
  expect(errors).toEqual([]);
  // On a computer, «Jugar gratis» goes to the game.
  await page.locator('.hero').getByRole('link', { name: 'Jugar gratis' }).click();
  await expect(page).toHaveURL(/\/galaxy\/crear-cuenta$/);
});

test('las páginas legales, robots.txt, el mapa del sitio y un 404 de verdad', async ({ page, request }) => {
  for (const [path, title] of [
    ['/aviso-legal', 'Aviso legal'],
    ['/privacidad', 'Política de privacidad'],
    ['/cookies', 'Política de cookies'],
    ['/condiciones', 'Condiciones de uso y de compra'],
  ] as const) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  }
  const robots = await request.get('/robots.txt');
  expect(await robots.text()).toContain('Sitemap: https://galaxysurvivor.es/sitemap.xml');
  const sitemap = await request.get('/sitemap.xml');
  expect(await sitemap.text()).toContain('<loc>https://galaxysurvivor.es/</loc>');
  const missing = await page.goto('/esto-no-existe');
  expect(missing?.status()).toBe(404);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
});
