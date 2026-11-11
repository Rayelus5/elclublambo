import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { RunStart } from '@galaxy/shared';
import { type Page, expect, skipProbeTest, test } from './fixtures';
import { E2E_ENV } from '../playwright.config';

// The Laboratorio against the real server (GDD §10.6, M4b-2): a new account repairs it from the station with what the
// CLI grants, buys Blindaje reforzado on the whiteboard, sees Propulsores open, and launches a run carrying the lab's
// life bonus.
// Writes e2e_* accounts only.
const PASS = 'una-clave-larga-e2e';
const cli = fileURLToPath(new URL('../../server/dist/cli.js', import.meta.url));
const grant = (username: string, currency: string, amount: number) =>
  execFileSync('node', [cli, 'grant', username, currency, String(amount), '--reason', 'e2e'], { env: { ...process.env, ...E2E_ENV } });

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

test('el laboratorio: repararlo, comprar Blindaje reforzado y salir con su vida', async ({ page }) => {
  const csp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  const username = await newAccount(page);
  // The repair (50 components and 500 coins) and the first level of Blindaje reforzado (40 dust and 15 components).
  grant(username, 'components', 65);
  grant(username, 'coins', 500);
  grant(username, 'dust', 40);

  await page.goto('/galaxy/estacion');
  const deck = page.getByRole('list', { name: 'Estación' });
  await deck.getByRole('button', { name: /Laboratorio/ }).click();
  const panel = page.getByRole('dialog', { name: 'Laboratorio' });
  await panel.getByRole('button', { name: /Reparar/ }).click();
  await expect(deck.getByRole('link', { name: /Laboratorio/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await deck.getByRole('link', { name: /Laboratorio/ }).click();
  await expect(page).toHaveURL(/\/galaxy\/laboratorio$/);

  // The whiteboard (shop and lab plan, F3): a node opens its panel, «Mejorar» fills its first segment.
  await expect(page.getByRole('group', { name: 'Pizarra del laboratorio' })).toBeVisible();
  await page.getByRole('button', { name: /^Blindaje reforzado, nivel 0 de 5/ }).click();
  await page.getByRole('complementary', { name: 'Blindaje reforzado' }).getByRole('button', { name: 'Mejorar a nivel 1' }).click();
  await expect(page.getByRole('button', { name: /^Blindaje reforzado, nivel 1 de 5/ })).toBeVisible();
  // Propulsores opens (it needs Blindaje reforzado); the wallet is empty now, so it waits for material.
  await page.getByRole('button', { name: /^Propulsores, nivel 0 de 5, disponible/ }).click();
  await expect(page.getByRole('complementary', { name: 'Propulsores' }).getByRole('button', { name: 'Te falta material' })).toBeDisabled();
  // The list is one press away, the same tree.
  await page.getByRole('button', { name: 'Lista', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Sonda' }).locator('.lab-node').filter({ has: page.getByText('Blindaje reforzado', { exact: true }) })).toContainText('Nivel 1 de 5');

  await page.goto('/galaxy/incursion');
  const started = page.waitForResponse((r) => r.url().endsWith('/galaxy/api/runs') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Lanzar incursión' }).click();
  const run = (await (await started).json()) as RunStart;
  expect(run.bonuses).toContainEqual({ stat: 'maxHp', value: 0.02 });
  await expect(page.locator('.arena-canvas')).toBeVisible({ timeout: 30_000 });
  expect(csp).toEqual([]);
});
