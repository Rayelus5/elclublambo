import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Browser } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import { type Page, expect, skipProbeTest, test } from './fixtures';
import { E2E_ENV } from '../playwright.config';

// Trade moderation against the real server (GDD §16.4; M6c-2). Two e2e players at the trade level swap galaxies the
// admin granted them; a new admin (CLI) finds the trade in Comercio, sees each galaxy going back in the revert dialog,
// reverts it with the password and sees «Revertido»; then withdraws a listing of one of them. No CSP violations.
// Writes e2e_* accounts, their galaxies, a trade and a listing only.
const cli = fileURLToPath(new URL('../../server/dist/cli.js', import.meta.url));
const PASS = 'una-clave-larga-e2e';
type Creds = { username: string; password: string; totpSecret: string };

interface PgClient {
  connect(): Promise<void>;
  query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
  end(): Promise<void>;
}

/** The trade level for this e2e account: level 10 and an account four days old, in its own rows. */
async function trader(username: string) {
  const { Client } = createRequire(fileURLToPath(new URL('../../server/package.json', import.meta.url)))('pg') as { Client: new (o: { connectionString: string }) => PgClient };
  const db = new Client({ connectionString: E2E_ENV.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{ id: string }>('select id from galaxy.accounts where username = $1', [username]);
    await db.query('insert into galaxy.account_xp (account_id, xp) values ($1, 100000) on conflict (account_id) do update set xp = 100000', [rows[0]!.id]);
    await db.query("update galaxy.accounts set created_at = now() - interval '4 days' where id = $1", [rows[0]!.id]);
  } finally {
    await db.end();
  }
}

async function player(browser: Browser, baseURL: string | undefined): Promise<{ page: Page; username: string }> {
  const b = randomBytes(3);
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1600, height: 900 }, extraHTTPHeaders: { 'cf-connecting-ip': `10.${b[0]}.${b[1]}.${b[2]}` } });
  const page = await ctx.newPage();
  const username = `e2e_${randomBytes(4).toString('hex')}`;
  await page.goto('/galaxy/crear-cuenta');
  await page.getByLabel('Usuario').fill(username);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASS);
  await page.getByLabel('Repite la contraseña').fill(PASS);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await skipProbeTest(page);
  await trader(username);
  return { page, username };
}

async function signIn(page: Page, creds: Creds) {
  await page.goto('/galaxy/entrar');
  await page.getByLabel('Usuario').fill(creds.username);
  await page.getByLabel('Contraseña', { exact: true }).fill(creds.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/galaxy\/verificar$/);
  await page.getByLabel('Código').fill(TOTP.generate({ secret: Secret.fromBase32(creds.totpSecret), algorithm: 'SHA1', digits: 6, period: 30 }));
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.locator('.hud').getByText(creds.username, { exact: true })).toBeVisible();
}

test('un admin revierte un trueque viendo a dónde vuelve cada galaxia y retira un anuncio', async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000);
  const origin = new URL(baseURL!).origin;
  const csp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  const [a, b] = await Promise.all([player(browser, baseURL), player(browser, baseURL)]);
  const creds = JSON.parse(
    execFileSync('node', [cli, 'create-admin', `e2e_adm_${randomBytes(4).toString('hex')}`, '--role', 'admin', '--json'], { env: { ...process.env, ...E2E_ENV }, encoding: 'utf8' }).trim().split('\n').at(-1)!,
  ) as Creds;
  await signIn(page, creds);

  // A galaxy each, from the panel's API (audited like any grant), and the swap between them.
  const grant = async (username: string) => {
    const res = await page.request.post(`/galaxy/api/admin/players/${username}/galaxies`, { data: { tier: 'common', finish: 'normal', reason: 'Galaxia para el e2e del comercio' }, headers: { origin } });
    expect(res.status()).toBe(200);
    return ((await res.json()) as { id: string }).id;
  };
  const [ga, gb] = [await grant(a.username), await grant(b.username)];
  const proposed = await a.page.request.post('/galaxy/api/trades', { data: { username: b.username, give: ga, want: gb }, headers: { origin, 'idempotency-key': randomUUID() } });
  expect(proposed.status()).toBe(200);
  const trade = (await proposed.json()) as { id: string; version: number };
  expect((await b.page.request.post(`/galaxy/api/trades/${trade.id}/confirm`, { data: { version: trade.version }, headers: { origin } })).status()).toBe(200);

  // The admin finds it in Comercio and reverts it.
  await page.goto(`/galaxy/admin/moderacion/comercio?tipo=trueques&cuenta=${a.username}`);
  const trades = page.getByRole('table', { name: 'Trueques' });
  await expect(trades.getByText('Cerrado', { exact: true })).toBeVisible();
  await trades.getByRole('button', { name: `Revertir el trueque de ${a.username} y ${b.username}` }).click();
  const dialog = page.getByRole('dialog', { name: `Revertir el trueque de ${a.username} y ${b.username}` });
  await expect(dialog.getByText(`vuelve de ${b.username} a ${a.username}`, { exact: false })).toBeVisible();
  await expect(dialog.getByText(`vuelve de ${a.username} a ${b.username}`, { exact: false })).toBeVisible();
  await dialog.getByLabel('Motivo').fill('Trueque de prueba revertido');
  await dialog.getByLabel('Tu contraseña').fill(creds.password);
  await dialog.getByRole('button', { name: 'Revertir' }).click();
  await expect(page.getByRole('status')).toHaveText('Hecho. Queda en la auditoría');
  await expect(trades.getByText('Revertido', { exact: true })).toBeVisible();

  // A's galaxy is A's again: listed, then withdrawn by the admin.
  const listed = await a.page.request.post('/galaxy/api/market/listings', { data: { galaxyId: ga, price: 500 }, headers: { origin, 'idempotency-key': randomUUID() } });
  expect(listed.status()).toBe(200);
  await page.getByRole('button', { name: 'Anuncios' }).click();
  const listings = page.getByRole('table', { name: 'Anuncios del mercado' });
  await expect(listings.getByText('Activo', { exact: true })).toBeVisible();
  await listings.getByRole('button', { name: /^Retirar el anuncio de / }).click();
  const withdraw = page.getByRole('dialog', { name: /^Retirar el anuncio de / });
  await expect(withdraw.getByLabel('Tu contraseña')).toHaveCount(0);
  await withdraw.getByLabel('Motivo').fill('Anuncio de prueba retirado');
  await withdraw.getByRole('button', { name: 'Retirar' }).click();
  await expect(page.getByRole('status')).toHaveText('Hecho. Queda en la auditoría');
  await expect(listings.getByText('Cancelado', { exact: true })).toBeVisible();

  expect(csp).toEqual([]);
  await Promise.all([a.page.context().close(), b.page.context().close()]);
});
