import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { type Page, expect, test } from '@playwright/test';
import { E2E_ENV } from '../playwright.config';

// The collection against the real server (GDD §8.5): cards drawn by the engine, the detail, disintegrating for the
// dust it promised, and fusing five commons into an uncommon. Writes e2e_* accounts only.
const PASS = 'una-clave-larga-e2e';
const cli = fileURLToPath(new URL('../../server/dist/cli.js', import.meta.url));

async function playerWithGalaxies(page: Page, baseURL: string, extraPulls: number): Promise<string> {
  const username = `e2e_${randomBytes(4).toString('hex')}`;
  await page.goto('/galaxy/crear-cuenta');
  await page.getByLabel('Usuario').fill(username);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASS);
  await page.getByLabel('Repite la contraseña').fill(PASS);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.locator('.hud').getByText(username, { exact: true })).toBeVisible();
  if (extraPulls > 0) {
    const env = { ...process.env, ...E2E_ENV };
    execFileSync('node', [cli, 'grant', username, 'signal', String(extraPulls * 10), '--reason', 'e2e'], { env });
    execFileSync('node', [cli, 'grant', username, 'dust', '500', '--reason', 'e2e'], { env });
  }
  for (let i = 0; i < 1 + extraPulls; i++) {
    const res = await page.request.post('/galaxy/api/gacha/pull', {
      headers: { origin: baseURL, 'idempotency-key': randomUUID() },
      data: { banner: 'deep-scan', count: 10, pay: 'signal' },
    });
    expect(res.status()).toBe(200);
  }
  return username;
}

const dustLabel = (page: Page) => page.locator('.hud .res.dust').getAttribute('aria-label');

test('la colección dibuja las cartas, abre el detalle y desintegrar paga lo prometido', async ({ page, baseURL }) => {
  await playerWithGalaxies(page, baseURL!, 0);
  await page.getByRole('link', { name: /Colección/ }).click();
  await expect(page).toHaveURL(/\/galaxy\/coleccion$/);
  await expect(page.getByRole('article')).toHaveCount(10);
  await expect(page.locator('article[data-image="ready"]').first()).toBeAttached({ timeout: 20_000 });

  await page.getByRole('link', { name: /^Ver / }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.relief')).not.toHaveText('⠋⠙⠹', { timeout: 20_000 });
  const worth = Number((await dialog.locator('.detail-facts div').nth(2).locator('dd').innerText()).replace(/\D/g, ''));
  const before = Number((await dustLabel(page))!.replace(/\D/g, ''));
  await dialog.getByRole('button', { name: 'Desintegrar' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Desintegrar' }).click();
  await expect(page.getByRole('status')).toContainText('se ha convertido en');
  await expect.poll(async () => Number((await dustLabel(page))!.replace(/\D/g, ''))).toBe(before + worth);
  await expect(page.getByRole('article')).toHaveCount(9);
});

test('fusionar cinco comunes da una poco común y la revela', async ({ page, baseURL }) => {
  await playerWithGalaxies(page, baseURL!, 4);
  await page.goto('/galaxy/coleccion?tier=common');
  await expect(page.getByRole('article').first()).toBeVisible();
  const before = await page.getByRole('article').count();
  expect(before).toBeGreaterThanOrEqual(5);
  await page.getByRole('button', { name: 'Fusionar', exact: true }).click();
  const picks = page.getByRole('button', { name: /^Seleccionar / });
  for (let i = 0; i < 5; i++) await picks.nth(i).click();
  const bar = page.getByRole('region', { name: 'Fusionar' });
  await expect(bar).toContainText('Cuesta 20 de polvo estelar');
  await bar.getByRole('button', { name: 'Fusionar ahora' }).click();
  const reveal = page.getByRole('dialog', { name: 'Nueva galaxia' });
  await expect(reveal.getByRole('article')).toContainText('Poco común');
  await reveal.getByRole('button', { name: 'Ver en la colección' }).click();
  await expect(page.getByRole('article')).toHaveCount(before - 5);
});
