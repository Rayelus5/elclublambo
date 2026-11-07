import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { type Page, expect, skipProbeTest, test } from './fixtures';
import { E2E_ENV } from '../playwright.config';

// The station against the real server (GDD §10): a new account enters from the Hogar and finds the Antenna broken,
// loads the refinery with raw material granted by the CLI and repairs the antenna with components. Writes e2e_*
// accounts only.
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

test('la estación: entrar desde el Hogar, cargar la refinería y reparar la antena', async ({ page }) => {
  const csp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  const username = await newAccount(page);
  await page.getByRole('link', { name: /Hogar/ }).click();
  await expect(page).toHaveURL(/\/galaxy\/estacion$/);
  const deck = page.getByRole('list', { name: 'Estación' });
  await expect(deck.getByRole('listitem')).toHaveCount(10);
  await expect(deck.getByRole('button', { name: /Antena/ })).toContainText('Rota');
  await expect(deck.getByRole('link', { name: /Hangar/ })).toHaveAttribute('href', '/galaxy/incursion');
  await expect(deck.getByRole('listitem').filter({ hasText: 'Laboratorio' })).toContainText('En reparación');

  // Raw material from the CLI (as if from incursions) goes into the refinery's queue.
  grant(username, 'material', 60);
  await page.reload();
  await deck.getByRole('button', { name: /Refinería/ }).click();
  const refinery = page.getByRole('dialog', { name: 'Refinería' });
  await expect(refinery).toContainText('20 por hora');
  await expect(refinery.getByRole('spinbutton', { name: 'Cantidad' })).toHaveValue('60');
  await refinery.getByRole('button', { name: 'Cargar' }).click();
  await expect(refinery.getByRole('progressbar', { name: 'En cola' })).toHaveAttribute('aria-valuenow', '60');
  await expect(page.getByRole('img', { name: '0 de material en bruto' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(refinery).toBeHidden();

  // Components repair the antenna: it starts catching signals.
  grant(username, 'components', 30);
  await page.reload();
  await deck.getByRole('button', { name: /Antena/ }).click();
  const antenna = page.getByRole('dialog', { name: 'Antena' });
  await antenna.getByRole('button', { name: /Reparar/ }).click();
  await expect(antenna).toContainText('Una señal cada 8 h');
  await expect(page.getByRole('img', { name: '0 componentes' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(deck.getByRole('button', { name: /Antena/ })).toContainText('Nivel 1');
  expect(csp).toEqual([]);
});
