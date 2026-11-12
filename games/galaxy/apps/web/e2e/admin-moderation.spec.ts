import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Browser } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import { type Page, expect, pickOption, skipProbeTest, test } from './fixtures';
import { E2E_ENV } from '../playwright.config';

// Moderation against the real server (GDD §16.1, §16.4; M6c-1). A new moderator (CLI) signs in with TOTP and reaches
// only Moderación: keeps a reported message visible from the queue, hides and restores another in the live chat, mutes
// its author and lifts it; the players' API answers 403. A new admin renames a player's clan from Clanes. No CSP
// violations. Writes e2e_* accounts, their messages and their clan only (every text and name is unique per run).
const cli = fileURLToPath(new URL('../../server/dist/cli.js', import.meta.url));
const PASS = 'una-clave-larga-e2e';
type Creds = { username: string; password: string; totpSecret: string };

interface PgClient {
  connect(): Promise<void>;
  query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
  end(): Promise<void>;
}

/** Level 5 for this e2e account (what writing, reporting and founding a clan need): its own experience row. */
async function levelUp(username: string) {
  const { Client } = createRequire(fileURLToPath(new URL('../../server/package.json', import.meta.url)))('pg') as { Client: new (o: { connectionString: string }) => PgClient };
  const db = new Client({ connectionString: E2E_ENV.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{ id: string }>('select id from galaxy.accounts where username = $1', [username]);
    await db.query('insert into galaxy.account_xp (account_id, xp) values ($1, 1000) on conflict (account_id) do update set xp = 1000', [rows[0]!.id]);
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
  await levelUp(username);
  return { page, username };
}

function staff(role: 'moderator' | 'admin'): Creds {
  const prefix = role === 'admin' ? 'e2e_adm' : 'e2e_mod';
  const out = execFileSync('node', [cli, 'create-admin', `${prefix}_${randomBytes(4).toString('hex')}`, '--role', role, '--json'], { env: { ...process.env, ...E2E_ENV }, encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').at(-1)!) as Creds;
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

function watchCsp(page: Page): string[] {
  const csp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  return csp;
}

/** Confirms the open dialog with a reason (and nothing else), with its button named as the action. */
async function confirm(page: Page, title: string, reason: string, submit = title) {
  const dialog = page.getByRole('dialog', { name: title });
  await dialog.getByLabel('Motivo').fill(reason);
  await dialog.getByRole('button', { name: submit }).click();
  await expect(page.getByRole('status')).toHaveText('Hecho. Queda en la auditoría');
}

test('un moderador revisa una denuncia, oculta y restaura en vivo, y silencia y levanta', async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000);
  const origin = new URL(baseURL!).origin;
  const [writer, reporter] = await Promise.all([player(browser, baseURL), player(browser, baseURL)]);
  const say = async (body: string) => {
    const res = await writer.page.request.post('/galaxy/api/chat/global/messages', { data: { body }, headers: { origin } });
    expect(res.status()).toBe(200);
    return ((await res.json()) as { id: string }).id;
  };
  const reported = `denunciado ${randomBytes(4).toString('hex')}`;
  const watched = `en vivo ${randomBytes(4).toString('hex')}`;
  const reportedId = await say(reported);
  await say(watched);
  expect((await reporter.page.request.post(`/galaxy/api/chat/messages/${reportedId}/report`, { data: { reason: 'Me ofende' }, headers: { origin } })).status()).toBe(200);

  // A moderator reaches the panel, and only its Moderación.
  const csp = watchCsp(page);
  await signIn(page, staff('moderator'));
  await page.getByRole('link', { name: 'Administración' }).click();
  await expect(page).toHaveURL(/\/galaxy\/admin\/moderacion$/);
  const side = page.getByRole('navigation', { name: 'Secciones del panel' });
  await expect(side.getByRole('link')).toHaveText(['Moderación']);
  expect((await page.request.get('/galaxy/api/admin/players?q=e2e')).status()).toBe(403);

  // The queue: the reported message, kept visible with a reason.
  const card = page.getByRole('article').filter({ hasText: reported });
  await expect(card.getByText('Me ofende')).toBeVisible();
  await card.getByRole('button', { name: 'Dejar visible' }).click();
  await confirm(page, 'Dejar visible', 'No incumple las normas');
  await expect(card).toHaveCount(0);

  // The live chat: hide the other message and restore it.
  const sub = page.getByRole('navigation', { name: 'Apartados de moderación' });
  await sub.getByRole('link', { name: 'Chat en vivo' }).click();
  const live = page.getByRole('article').filter({ hasText: watched });
  await live.getByRole('button', { name: 'Ocultar' }).click();
  await confirm(page, 'Ocultar', 'Prueba de ocultar');
  await expect(live.getByText('Oculto por e2e_mod_', { exact: false })).toBeVisible();
  await live.getByRole('button', { name: 'Restaurar' }).click();
  await confirm(page, 'Restaurar', 'Prueba de restaurar');
  await expect(live.getByText('Oculto por', { exact: false })).toHaveCount(0);

  // Mute the writer, who can no longer write, and lift it.
  await sub.getByRole('link', { name: 'Silencios' }).click();
  await page.getByRole('button', { name: 'Silenciar una cuenta' }).click();
  const mute = page.getByRole('dialog', { name: 'Silenciar una cuenta' });
  await mute.getByLabel('Cuenta').fill(writer.username);
  await pickOption(mute, 'Duración', '1 hora');
  await confirm(page, 'Silenciar una cuenta', 'Prueba de silencio', 'Silenciar');
  await expect(page.getByRole('cell', { name: writer.username, exact: true })).toBeVisible();
  expect((await writer.page.request.post('/galaxy/api/chat/global/messages', { data: { body: 'sigo aquí' }, headers: { origin } })).status()).toBe(403);
  await page.getByRole('button', { name: `Levantar el silencio de ${writer.username}` }).click();
  await confirm(page, `Levantar el silencio de ${writer.username}`, 'Fin de la prueba', 'Levantar');
  await expect(page.getByRole('cell', { name: writer.username, exact: true })).toHaveCount(0);
  await say(`de vuelta ${randomBytes(3).toString('hex')}`);

  expect(csp).toEqual([]);
  await Promise.all([writer.page.context().close(), reporter.page.context().close()]);
});

test('un admin renombra el clan de un jugador desde Moderación', async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  const origin = new URL(baseURL!).origin;
  const leader = await player(browser, baseURL);
  const csp = watchCsp(page);
  await signIn(page, staff('admin'));
  // The founding cost, from the panel's API (audited like any gift).
  expect((await page.request.post(`/galaxy/api/admin/players/${leader.username}/wallet`, { data: { currency: 'coins', amount: 2000, reason: 'Coste del clan de prueba' }, headers: { origin } })).status()).toBe(200);
  const tag = randomBytes(2).toString('hex').toUpperCase();
  const name = `Clan ${randomBytes(3).toString('hex')}`;
  const created = await leader.page.request.post('/galaxy/api/clans', { data: { name, tag, emblem: 'eye', color: 'ice' }, headers: { origin, 'idempotency-key': randomUUID() } });
  expect(created.status()).toBe(200);

  await page.getByRole('link', { name: 'Administración' }).click();
  await page.getByRole('navigation', { name: 'Secciones del panel' }).getByRole('link', { name: 'Moderación' }).click();
  await page.getByRole('navigation', { name: 'Apartados de moderación' }).getByRole('link', { name: 'Clanes' }).click();
  await page.getByRole('searchbox', { name: 'Buscar por etiqueta o nombre' }).fill(tag);
  await page.getByRole('table').getByRole('link', { name: tag, exact: true }).click();
  await expect(page.getByRole('heading', { name: `[${tag}] ${name}` })).toBeVisible();
  await expect(page.getByRole('cell', { name: leader.username, exact: true })).toBeVisible();

  const renamed = `Limpio ${randomBytes(3).toString('hex')}`;
  await page.getByRole('button', { name: 'Renombrar' }).click();
  await page.getByRole('dialog', { name: 'Renombrar' }).getByLabel('Nombre nuevo').fill(renamed);
  await confirm(page, 'Renombrar', 'Nombre ofensivo de prueba');
  await expect(page.getByRole('heading', { name: `[${tag}] ${renamed}` })).toBeVisible();
  expect(csp).toEqual([]);
  await leader.page.context().close();
});
