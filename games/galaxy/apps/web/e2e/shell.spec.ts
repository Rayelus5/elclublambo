import { expect, test } from './fixtures';

// The game's shell from the real build (galaxysurvivor.es plan, PR 2): Vite keeps the head marker, so each screen's
// title, noindex and the link-preview cards reach the browser, and the tab follows the screen. Writes nothing.

test('el shell compilado lleva su cabecera, sin indexar, y la pestaña sigue a la pantalla', async ({ page, request }) => {
  const res = await request.get('/galaxy/crear-cuenta?ref=ABCD');
  expect(res.status()).toBe(200);
  expect(res.headers()['x-robots-tag']).toBe('noindex');
  const html = await res.text();
  expect(html).not.toContain('<!--gs:head-->');
  expect(html.match(/<title>/g)).toHaveLength(1);
  expect(html).toContain('<title>Crear cuenta | Galaxy Survivor</title>');
  expect(html).toContain('<meta name="robots" content="noindex">');
  expect(html).toContain('<meta property="og:url" content="http://localhost:8090/galaxy/crear-cuenta?ref=ABCD">');
  expect(html).toMatch(/<script type="module" crossorigin src="\/galaxy\/assets\/index-[^"]+\.js"><\/script>/);

  await page.goto('/galaxy/entrar');
  await expect(page).toHaveTitle('Entrar | Galaxy Survivor');
  await page.getByRole('link', { name: 'Crear cuenta', exact: true }).click();
  await expect(page).toHaveTitle('Crear cuenta | Galaxy Survivor');
});
