import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { HangarView, RunStart } from '@galaxy/shared';
import { type Page, expect, skipProbeTest, test } from './fixtures';
import { E2E_ENV } from '../playwright.config';

// Probe levels and the starting weapon against the real server (GDD §6, M4b-1): a new account levels its probe up in
// the Hangar with components and coins granted by the CLI, picks the variant level 4 opens and launches with it.
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

test('subir de nivel la sonda, elegir la variante del nivel 4 y salir con ella', async ({ page }) => {
  const csp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  const username = await newAccount(page);
  const hangar = (await (await page.request.get('/galaxy/api/hangar')).json()) as HangarView;
  const probe = hangar.probes.find((p) => p.id === hangar.probe)!;
  const variant = probe.variants.find((v) => v.unlockAt === 4)!;

  grant(username, 'components', 20);
  grant(username, 'coins', 300);
  await page.goto('/galaxy/incursion');
  await page.getByRole('button', { name: /Subir a nivel 2/ }).click();
  await expect(page.getByText('Nivel 2 de 10')).toBeVisible();

  // Levels 3 and 4: 35 + 60 components and 600 + 1000 coins.
  grant(username, 'components', 95);
  grant(username, 'coins', 1600);
  await page.reload();
  await page.getByRole('button', { name: /Subir a nivel 3/ }).click();
  await expect(page.getByText('Nivel 3 de 10')).toBeVisible();
  await page.getByRole('button', { name: /Subir a nivel 4/ }).click();
  await expect(page.getByText('Nivel 4 de 10')).toBeVisible();

  const weapons = page.getByRole('radiogroup', { name: 'Arma inicial' });
  const radio = weapons.getByRole('radio', { name: new RegExp(variant.name) });
  await expect(radio).toBeEnabled();
  // A controlled radio settles after React re-renders: click and wait for the state (check() reads it at once).
  await radio.click();
  await expect(radio).toBeChecked();

  // Launching starts the run with the level's bonuses and the variant.
  const started = page.waitForResponse((r) => r.url().endsWith('/galaxy/api/runs') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Lanzar incursión' }).click();
  const run = (await (await started).json()) as RunStart;
  expect(run.variant).toBe(variant.id);
  expect(run.bonuses.length).toBeGreaterThan(0);
  await expect(page.locator('.arena-canvas')).toBeVisible({ timeout: 30_000 });
  expect(csp).toEqual([]);
});
