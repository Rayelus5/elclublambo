import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { type Page, expect, skipProbeTest, test } from './fixtures';
import { E2E_ENV } from '../playwright.config';

// The market against the real server (GDD §14.6, §14.7; M5c-1): a seller at level 10 with a 4-day-old account (set
// in its own rows) pulls ten galaxies with its welcome signals and sells one from its collection's «Vender»; a buyer
// with coins from the CLI finds it in Comprar, confirms and gets it; the seller sees the sale with the buyer and the
// net. No CSP violations. Writes e2e_* accounts only.
const PASS = 'una-clave-larga-e2e';
const cli = fileURLToPath(new URL('../../server/dist/cli.js', import.meta.url));

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

interface PgClient {
  connect(): Promise<void>;
  query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
  end(): Promise<void>;
}

/** A trader: level 10 (experience in its own row) and an account 4 days old. */
async function makeTrader(username: string) {
  const { Client } = createRequire(fileURLToPath(new URL('../../server/package.json', import.meta.url)))('pg') as { Client: new (o: { connectionString: string }) => PgClient };
  const db = new Client({ connectionString: E2E_ENV.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{ id: string }>('select id from galaxy.accounts where username = $1', [username]);
    await db.query('insert into galaxy.account_xp (account_id, xp) values ($1, 50000) on conflict (account_id) do update set xp = 50000', [rows[0]!.id]);
    await db.query("update galaxy.accounts set created_at = now() - interval '4 days' where id = $1", [rows[0]!.id]);
  } finally {
    await db.end();
  }
}

function watchCsp(page: Page): string[] {
  const csp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  return csp;
}

test('vender una galaxia desde la colección y comprarla desde Comprar', async ({ page, baseURL, browser }) => {
  test.setTimeout(120_000);
  const csp = watchCsp(page);
  const seller = await newAccount(page);
  await makeTrader(seller);
  const pulled = await page.request.post('/galaxy/api/gacha/pull', { data: { banner: 'deep-scan', count: 10, pay: 'signal' }, headers: { 'idempotency-key': randomUUID(), origin: baseURL! } });
  expect(pulled.status()).toBe(200);
  const { items } = (await (await page.request.get('/galaxy/api/galaxies?sort=new&limit=30')).json()) as { items: { id: string; name: string; tier: string }[] };
  const g = items[0]!;

  // From the galaxy's detail, «Vender» leads to the market with it chosen and its floor as the price.
  await page.goto(`/galaxy/coleccion/${g.id}`);
  await page.getByRole('link', { name: 'Vender' }).click();
  await expect(page).toHaveURL(new RegExp(`/galaxy/mercado\\?pestana=vender&galaxia=${g.id}$`));
  const price = page.getByLabel('Precio en monedas');
  await expect(price).not.toHaveValue('');
  const floor = Number(await price.inputValue());
  await price.fill(String(floor * 2));
  await page.getByRole('button', { name: 'Poner en venta' }).click();
  await expect(page.getByRole('status')).toContainText(`${g.name} está en venta durante 7 días`);

  // The buyer finds it and buys it.
  const b = randomBytes(3);
  const other = await browser.newContext({ baseURL, viewport: { width: 1600, height: 900 }, extraHTTPHeaders: { 'cf-connecting-ip': `10.${b[0]}.${b[1]}.${b[2]}` } });
  const buyerPage = await other.newPage();
  const buyerCsp = watchCsp(buyerPage);
  const buyer = await newAccount(buyerPage);
  await makeTrader(buyer);
  execFileSync('node', [cli, 'grant', buyer, 'coins', String(floor * 4), '--reason', 'e2e'], { env: { ...process.env, ...E2E_ENV } });
  await buyerPage.getByRole('link', { name: 'Mercado' }).click();
  await expect(buyerPage).toHaveURL(/\/galaxy\/mercado$/);
  await buyerPage.getByLabel('Buscar por nombre').fill(g.name);
  await buyerPage.getByRole('button', { name: `Comprar ${g.name}` }).first().click();
  const confirm = buyerPage.getByRole('alertdialog', { name: `Comprar ${g.name}` });
  await expect(confirm).toContainText(`Tu saldo pasará de`);
  await confirm.getByRole('button', { name: /Comprar por/ }).click();
  await expect(confirm.getByText('Es tuya')).toBeVisible();
  await confirm.getByRole('link', { name: 'Verla en tu colección' }).click();
  await expect(buyerPage).toHaveURL(new RegExp(`/galaxy/coleccion/${g.id}$`));
  await expect(buyerPage.getByRole('dialog', { name: g.name })).toBeVisible();
  await other.close();

  // The seller sees the sale: the buyer and what it collected (the price minus 7 %).
  await page.goto('/galaxy/mercado?pestana=mios');
  const sale = page.getByRole('listitem').filter({ hasText: buyer });
  await expect(sale).toContainText(`Cobraste`);
  expect([...csp, ...buyerCsp]).toEqual([]);
});
