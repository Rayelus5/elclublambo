import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

// The 3D inspector in the production build with the real CSP (GDD §8.1, §18.1): its chunk (three.js) is requested only
// when it opens, it draws, it turns to the back, and nothing violates the Content Security Policy.
const PASS = 'una-clave-larga-e2e';

test('el inspector 3D carga three.js al abrirse, se dibuja y no viola la CSP', async ({ page, baseURL }) => {
  const csp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  const chunks: string[] = [];
  page.on('request', (r) => {
    if (/inspector-scene/.test(r.url())) chunks.push(r.url());
  });

  const username = `e2e_${randomBytes(4).toString('hex')}`;
  await page.goto('/galaxy/crear-cuenta');
  await page.getByLabel('Usuario').fill(username);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASS);
  await page.getByLabel('Repite la contraseña').fill(PASS);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.locator('.hud').getByText(username, { exact: true })).toBeVisible();
  const res = await page.request.post('/galaxy/api/gacha/pull', {
    headers: { origin: baseURL!, 'idempotency-key': randomUUID() },
    data: { banner: 'deep-scan', count: 1, pay: 'signal' },
  });
  expect(res.status()).toBe(200);

  await page.goto('/galaxy/coleccion');
  await page.getByRole('link', { name: /^Ver / }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(chunks).toEqual([]);

  await page.getByRole('button', { name: 'Inspeccionar en 3D' }).click();
  const inspector = page.locator('.inspector');
  await expect(inspector).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  expect(chunks.length).toBe(1);
  await page.getByRole('button', { name: 'Ver el reverso' }).click();
  await expect(page.getByRole('button', { name: 'Ver el anverso' })).toBeVisible();
  await page.getByRole('dialog', { name: /en 3D$/ }).getByRole('button', { name: 'Cerrar' }).click();
  await expect(inspector).toHaveCount(0);
  expect(csp).toEqual([]);
});
