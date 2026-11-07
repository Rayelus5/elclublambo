import { randomBytes, randomUUID } from 'node:crypto';
import type { HangarView, RunResult, RunStart } from '@galaxy/shared';
import { encodeLog, SIM_VERSION, toBase64 } from '@galaxy/sim';
import { type Page, expect, skipProbeTest, test } from './fixtures';

// The season, the leaderboard and the profiles against the real server (GDD §14.1, §14.2, §12.1; M5a): a new account
// plays a short run (started and finished through the API, one layer: plausible and worth 10 points and 15
// experience), finds itself in the leaderboard marked as its own row, and a second account opens its profile from
// there, sees its level and season, and goes into its collection and its planetarium. Writes e2e_* accounts only.
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

function watchCsp(page: Page): string[] {
  const csp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  return csp;
}

/** A one-second run in the first layer, through the API: what a player who dies at once sends. */
async function shortRun(page: Page, origin: string): Promise<RunResult> {
  const hangar = (await (await page.request.get('/galaxy/api/hangar')).json()) as HangarView;
  const start = await page.request.post('/galaxy/api/runs', {
    headers: { origin, 'idempotency-key': randomUUID() },
    data: { sector: hangar.sector, probe: hangar.probe, simVersion: SIM_VERSION },
  });
  expect(start.status()).toBe(200);
  const run = (await start.json()) as RunStart;
  await page.waitForTimeout(1500);
  const finish = await page.request.post(`/galaxy/api/runs/${run.id}/finish`, {
    headers: { origin, 'idempotency-key': randomUUID() },
    data: { outcome: 'died', ticks: 60, depth: 1, kills: 0, bossKills: 0, level: 1, loot: [{ coins: 0, dust: 0 }], hash: '0123456789abcdef', inputs: toBase64(encodeLog({ probes: 1, events: [] })) },
  });
  expect(finish.status()).toBe(200);
  return (await finish.json()) as RunResult;
}

test('jugar una incursión, verse en la clasificación y que otro abra tu perfil', async ({ page, baseURL, browser }) => {
  const csp = watchCsp(page);
  const player = await newAccount(page);
  const result = await shortRun(page, baseURL!);
  expect(result.progress).toEqual({ xp: 15, level: 1, levelUp: false, points: 10 });

  // The title screen's season column has your place; the leaderboard marks your row.
  await page.goto('/galaxy/');
  const season = page.getByRole('complementary', { name: /Temporada/ });
  await expect(season.getByRole('region', { name: 'Tu puesto' })).toContainText('10 puntos');
  await season.getByRole('link', { name: 'Ver clasificación completa' }).click();
  await expect(page).toHaveURL(/\/galaxy\/clasificacion$/);
  await expect(page.getByRole('navigation', { name: 'Pestañas de la clasificación' }).getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'page');
  const mine = page.locator('tr[aria-current="true"], .podium li[aria-current="true"]');
  await expect(mine).toContainText(player);
  await page.getByRole('link', { name: 'Profundidad' }).click();
  await expect(page).toHaveURL(/pestana=profundidad/);
  await expect(page.locator('tr[aria-current="true"], .podium li[aria-current="true"]')).toContainText(player);

  // Someone else opens that profile by its address and goes into the collection and the planetarium.
  const b = randomBytes(3);
  const other = await browser.newContext({ baseURL, extraHTTPHeaders: { 'cf-connecting-ip': `10.${b[0]}.${b[1]}.${b[2]}` } });
  const visitor = await other.newPage();
  const visitorCsp = watchCsp(visitor);
  await newAccount(visitor);
  await visitor.goto(`/galaxy/perfil/${player}`);
  await expect(visitor.getByRole('heading', { level: 1, name: player })).toBeVisible();
  await expect(visitor.getByText('Nivel 1', { exact: true })).toBeVisible();
  await expect(visitor.getByRole('region', { name: 'Esta temporada' })).toContainText('10');
  await expect(visitor.getByRole('region', { name: 'Récords' })).toContainText('1');
  await visitor.getByRole('link', { name: 'Ver su colección' }).click();
  await expect(visitor.getByRole('heading', { level: 1, name: `Colección de ${player}` })).toBeVisible();
  await expect(visitor.getByText('Todavía no tiene galaxias')).toBeVisible();
  await visitor.getByRole('link', { name: 'Volver al perfil' }).click();
  await visitor.getByRole('link', { name: 'Visitar su planetario' }).click();
  await expect(visitor.getByRole('heading', { level: 1, name: `Planetario de ${player}` })).toBeVisible();
  await visitor.goto('/galaxy/perfil/nadie_aqui_e2e');
  await expect(visitor.getByText('No hay ningún jugador con ese nombre')).toBeVisible();
  await other.close();

  // The avatar leads to one's own profile.
  await page.goto('/galaxy/');
  await page.getByRole('link', { name: /^Tu perfil/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: player })).toBeVisible();
  expect(csp).toEqual([]);
  expect(visitorCsp).toEqual([]);
});
