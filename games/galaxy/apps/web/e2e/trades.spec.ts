import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { type Page, expect, skipProbeTest, test } from './fixtures';
import { E2E_ENV } from '../playwright.config';

// Swaps against the real server (GDD §14.5; M5c-2): two traders (level 10, 4-day-old accounts, set in their rows) pull
// ten galaxies each with their welcome signals; A proposes from B's profile what it gives and what it wants; B finds it
// in the market's Trueques with its turn and confirms; the galaxies change hands. No CSP violations. e2e_* accounts only.
const PASS = 'una-clave-larga-e2e';

async function newTrader(page: Page, baseURL: string): Promise<string> {
  const username = `e2e_${randomBytes(4).toString('hex')}`;
  await page.goto('/galaxy/crear-cuenta');
  await page.getByLabel('Usuario').fill(username);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASS);
  await page.getByLabel('Repite la contraseña').fill(PASS);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await skipProbeTest(page);
  const { Client } = createRequire(fileURLToPath(new URL('../../server/package.json', import.meta.url)))('pg') as {
    Client: new (o: { connectionString: string }) => { connect(): Promise<void>; query<R>(t: string, v?: unknown[]): Promise<{ rows: R[] }>; end(): Promise<void> };
  };
  const db = new Client({ connectionString: E2E_ENV.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{ id: string }>('select id from galaxy.accounts where username = $1', [username]);
    await db.query('insert into galaxy.account_xp (account_id, xp) values ($1, 50000) on conflict (account_id) do update set xp = 50000', [rows[0]!.id]);
    await db.query("update galaxy.accounts set created_at = now() - interval '4 days' where id = $1", [rows[0]!.id]);
  } finally {
    await db.end();
  }
  const pulled = await page.request.post('/galaxy/api/gacha/pull', { data: { banner: 'deep-scan', count: 10, pay: 'signal' }, headers: { 'idempotency-key': randomUUID(), origin: baseURL } });
  expect(pulled.status()).toBe(200);
  return username;
}

function watchCsp(page: Page): string[] {
  const csp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  return csp;
}

test('proponer un trueque desde el perfil y confirmarlo en Trueques', async ({ page, baseURL, browser }) => {
  test.setTimeout(120_000);
  const csp = watchCsp(page);
  await newTrader(page, baseURL!);
  const b = randomBytes(3);
  const other = await browser.newContext({ baseURL, viewport: { width: 1600, height: 900 }, extraHTTPHeaders: { 'cf-connecting-ip': `10.${b[0]}.${b[1]}.${b[2]}` } });
  const bPage = await other.newPage();
  const bCsp = watchCsp(bPage);
  const bName = await newTrader(bPage, baseURL!);

  // A proposes from B's profile.
  await page.goto(`/galaxy/perfil/${bName}`);
  await page.getByRole('button', { name: 'Proponer trueque' }).click();
  const composer = page.getByRole('dialog', { name: `Trueque con ${bName}` });
  await composer.getByRole('button', { name: 'Elegir lo que doy' }).click();
  const give = page.getByRole('dialog', { name: 'Elige qué das' }).getByRole('button', { name: /^Dar / }).first();
  const gaveName = ((await give.getAttribute('aria-label')) ?? '').replace(/^Dar /, '');
  await give.click();
  await composer.getByRole('button', { name: 'Elegir lo que pido' }).click();
  const ask = page.getByRole('dialog', { name: `Elige qué pides a ${bName}` }).getByRole('button', { name: /^Pedir / }).first();
  const askedName = ((await ask.getAttribute('aria-label')) ?? '').replace(/^Pedir /, '');
  await ask.click();
  await composer.getByRole('button', { name: 'Proponer' }).click();
  await expect(page).toHaveURL(/\/galaxy\/mercado\?pestana=trueques$/);
  await expect(page.getByText(`Has confirmado. Esperando a ${bName}`)).toBeVisible();

  // B sees its turn and confirms.
  await bPage.goto('/galaxy/mercado?pestana=trueques');
  const card = bPage.getByRole('article').first();
  await expect(card).toContainText('ha confirmado. Te toca');
  await card.getByRole('button', { name: 'Confirmar trato' }).click();
  await expect(bPage.getByText(`Recibiste ${gaveName}`)).toBeVisible();
  await other.close();

  // A received what it asked for.
  await page.reload();
  await expect(page.getByText(`Recibiste ${askedName}`)).toBeVisible();
  expect([...csp, ...bCsp]).toEqual([]);
});
