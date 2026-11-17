import { expect, test } from './fixtures';

// The installable app against the real server and build (galaxysurvivor.es plan, PR 3): the manifest and the worker
// with their own types, the worker in control after a reload, the offline page for a page load without a network, and
// the API never answered by the worker. The other specs block workers (playwright.config.ts). Writes nothing.

test.use({ serviceWorkers: 'allow' });

test('el manifest, el worker y la página offline se sirven con su tipo', async ({ request }) => {
  const manifest = await request.get('/galaxy/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  expect(manifest.headers()['content-type']).toBe('application/manifest+json');
  expect((await manifest.json()).start_url).toBe('/galaxy/');
  const worker = await request.get('/galaxy/sw.js');
  expect(worker.headers()['content-type']).toBe('text/javascript; charset=utf-8');
  expect(worker.headers()['cache-control']).toBe('no-cache');
  for (const [url, type] of [
    ['/galaxy/offline.html', 'text/html; charset=utf-8'],
    ['/galaxy/offline.css', 'text/css; charset=utf-8'],
    ['/galaxy/icons/icon-512.png', 'image/png'],
    ['/galaxy/icons/shot-incursion.webp', 'image/webp'],
  ] as const) {
    const res = await request.get(url);
    expect(res.status(), url).toBe(200);
    expect(res.headers()['content-type'], url).toBe(type);
  }
  // A file that is not there is a 404, never the game's page.
  const missing = await request.get('/galaxy/icons/no-existe.png');
  expect(missing.status()).toBe(404);
});

test('el worker controla tras recargar, sin red da la página offline y nunca toca la API', async ({ page, context }) => {
  await page.goto('/galaxy/entrar');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)).toMatch(/\/galaxy\/sw\.js$/);

  // The API goes straight to the server, even from a controlled page.
  const api = page.waitForResponse((r) => r.url().endsWith('/galaxy/api/health'));
  await page.evaluate(() => fetch('/galaxy/api/health').then((r) => r.status));
  const health = await api;
  expect(health.status()).toBe(200);
  expect(health.fromServiceWorker()).toBe(false);

  await context.setOffline(true);
  try {
    await page.goto('/galaxy/escaner');
    await expect(page.getByRole('heading', { level: 1, name: 'Sin conexión' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reintentar' })).toHaveAttribute('href', '/galaxy/');
    // Its style sheet came from the worker's cache too.
    await expect(page.getByRole('link', { name: 'Reintentar' })).toHaveCSS('display', 'inline-flex');
  } finally {
    await context.setOffline(false);
  }
  // Back online, the same address is the game again.
  await page.goto('/galaxy/entrar');
  await expect(page).toHaveTitle('Entrar | Galaxy Survivor');
});
