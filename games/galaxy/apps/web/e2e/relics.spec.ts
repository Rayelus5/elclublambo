import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { SIM_VERSION } from '@galaxy/sim';
import { type Page, expect, skipProbeTest, test } from './fixtures';
import { E2E_ENV } from '../playwright.config';

// Relic levels and slots against the real server (GDD §8.4, §8.4 bis; M4c-1): a new account takes a galaxy to level 3
// from its detail with dust the CLI grants and gets half of it back when it disintegrates it; then it meets slot 3's
// milestone and opens it from the Hangar. Writes e2e_* accounts only (their own finished runs included).
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

/**
 * Five finished two-minute runs for this e2e account, straight into its own rows (what finishing them would leave):
 * a real run counts only from a minute up, too long for an e2e. Uses the server's driver, as the integration tests do.
 */
async function finishedRuns(username: string, n: number) {
  const { Client } = createRequire(fileURLToPath(new URL('../../server/package.json', import.meta.url)))('pg') as { Client: new (o: { connectionString: string }) => PgClient };
  const db = new Client({ connectionString: E2E_ENV.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{ id: string }>('select id from galaxy.accounts where username = $1', [username]);
    for (let k = 0; k < n; k++) {
      await db.query(
        `insert into galaxy.runs (account_id, seed, sector, probe, relics, content_version, sim_version, start_key, started_at, finished_at,
           outcome, ticks, depth, kills, boss_kills, level, seconds, hash, payout, runs_version, flags, suspicious)
         values ($1, '1', 'outer-nebula', 'lumen', '[]', 0, $2, $3, now(), now(), 'died', 7200, 1, 10, 0, 3, 120, '0123456789abcdef', '{}', 0, '{}', false)`,
        [rows[0]!.id, SIM_VERSION, randomUUID()],
      );
    }
  } finally {
    await db.end();
  }
}

interface PgClient {
  connect(): Promise<void>;
  query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
  end(): Promise<void>;
}

const dustLabel = (page: Page) => page.locator('.hud .res.dust').getAttribute('aria-label');
const amount = (s: string | null) => Number(s!.replace(/\D/g, ''));

test('subir una galaxia al nivel 3 desde su detalle y recuperar la mitad al desintegrarla', async ({ page, baseURL }) => {
  const csp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  const username = await newAccount(page);
  const pull = await page.request.post('/galaxy/api/gacha/pull', {
    headers: { origin: baseURL!, 'idempotency-key': randomUUID() },
    data: { banner: 'deep-scan', count: 10, pay: 'signal' },
  });
  expect(pull.status()).toBe(200);
  // Levels 2 and 3: 20 + 35 dust.
  grant(username, 'dust', 55);

  await page.goto('/galaxy/coleccion');
  await page.getByRole('link', { name: /^Ver / }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Nivel 1 de 10');
  await dialog.getByRole('button', { name: /Subir a nivel 2/ }).click();
  await expect(dialog).toContainText('Nivel 2 de 10');
  await dialog.getByRole('button', { name: /Subir a nivel 3/ }).click();
  await expect(dialog).toContainText('Nivel 3 de 10');
  await expect(dialog).toContainText('Al desintegrarla o fusionarla devuelve 27 de polvo de sus niveles');
  // The wallet is empty now, so level 4 (55 dust) waits and says what is missing.
  await expect(dialog.getByRole('button', { name: /Subir a nivel 4/ })).toBeDisabled();
  await expect(dialog).toContainText('Te faltan 55 de polvo');

  // What it gives includes the refund; the wallet gets exactly that.
  const worth = amount(await dialog.locator('.detail-facts div').nth(2).locator('dd').innerText());
  expect(worth).toBeGreaterThanOrEqual(27);
  await expect.poll(async () => amount(await dustLabel(page))).toBe(0);
  await dialog.getByRole('button', { name: 'Desintegrar' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Desintegrar' }).click();
  // The collection's toast (the level-up celebration is a status of its own while it lasts).
  await expect(page.getByRole('status').filter({ hasText: 'se ha convertido en' })).toBeVisible();
  await expect.poll(async () => amount(await dustLabel(page))).toBe(worth);
  expect(csp).toEqual([]);
});

test('la ranura 3 enseña su hito y, cumplido, se abre en el Hangar con su polvo', async ({ page }) => {
  const csp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  const username = await newAccount(page);
  await page.goto('/galaxy/incursion');
  const slot3 = page.getByRole('group', { name: 'Ranura 3' });
  await expect(slot3).toContainText('Juega 5 incursiones');
  await expect(slot3).toContainText('0/5');
  await expect(slot3.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Elegir reliquia' })).toHaveCount(2);

  await finishedRuns(username, 5);
  grant(username, 'dust', 100);
  await page.reload();
  const open = slot3.getByRole('button', { name: /Abrir ranura/ });
  await expect(open).toContainText('100 de polvo');
  await open.click();
  await expect(page.getByRole('button', { name: 'Elegir reliquia' })).toHaveCount(3);
  await expect(page.getByRole('group', { name: 'Ranura 4' })).toContainText('Derrota 3 Núcleos');
  await expect.poll(async () => amount(await dustLabel(page))).toBe(0);
  expect(csp).toEqual([]);
});
