import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { type Page, expect, skipProbeTest, test } from './fixtures';
import { E2E_ENV } from '../playwright.config';

// The chats against the real server (GDD §14.4; M5b-2): two accounts at level 5 (experience set in their own rows)
// open «Comunidad»; one writes and the other sees it arrive through the socket without reloading, then reports it;
// an account at level 1 finds the field off with its reason. No CSP violation, the socket's included. Writes e2e_*
// accounts and their messages only (each text is unique, so earlier runs' messages are never met).
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

interface PgClient {
  connect(): Promise<void>;
  query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
  end(): Promise<void>;
}

/** Level 5 for this e2e account: 1000 experience straight into its own row. */
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

function watchCsp(page: Page): string[] {
  const csp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  return csp;
}

async function openChat(page: Page) {
  await page.goto('/galaxy/');
  await page.getByRole('button', { name: 'Comunidad' }).click();
  const sheet = page.getByRole('dialog', { name: 'Chat' });
  await expect(sheet.getByRole('log')).toBeVisible();
  return sheet;
}

const freshContext = (browser: import('@playwright/test').Browser, baseURL: string | undefined) => {
  const b = randomBytes(3);
  return browser.newContext({ baseURL, viewport: { width: 1600, height: 900 }, extraHTTPHeaders: { 'cf-connecting-ip': `10.${b[0]}.${b[1]}.${b[2]}` } });
};

test('dos jugadores hablan en Comunidad en vivo, uno denuncia, y sin nivel no se escribe', async ({ page, baseURL, browser }) => {
  test.setTimeout(120_000);
  const csp = watchCsp(page);
  const writer = await newAccount(page);
  await levelUp(writer);

  const other = await freshContext(browser, baseURL);
  const reader = await other.newPage();
  const readerCsp = watchCsp(reader);
  const readerName = await newAccount(reader);
  await levelUp(readerName);

  const sheet = await openChat(page);
  const readerSheet = await openChat(reader);
  await expect(readerSheet.getByRole('combobox', { name: 'Mensaje' })).toBeEnabled();

  // One writes; the other sees it come in without reloading.
  const text = `Hola desde la estación ${randomBytes(3).toString('hex')}`;
  const field = sheet.getByRole('combobox', { name: 'Mensaje' });
  await field.fill(text);
  await expect(sheet.getByText(`${[...text].length} de 280`)).toBeVisible();
  await field.press('Enter');
  await expect(field).toHaveValue('');
  await expect(sheet.getByRole('log').getByText(text)).toBeVisible();
  await expect(readerSheet.getByRole('log').getByText(text)).toBeVisible({ timeout: 10_000 });

  // The reader reports it: a confirmation, then «Denunciado».
  const message = readerSheet.getByRole('listitem').filter({ hasText: text });
  await message.hover();
  await message.getByRole('button', { name: `Denunciar el mensaje de ${writer}` }).click();
  const confirm = reader.getByRole('alertdialog', { name: 'Denunciar este mensaje' });
  await confirm.getByRole('button', { name: 'Denunciar' }).click();
  await expect(message.getByText('Denunciado')).toBeVisible();

  // Escape closes the sheet and the focus goes back to «Comunidad».
  await reader.keyboard.press('Escape');
  await expect(reader.getByRole('dialog', { name: 'Chat' })).toBeHidden();
  await expect(reader.getByRole('button', { name: 'Comunidad' })).toBeFocused();
  await other.close();

  // A new account (level 1): the field is off and says why.
  const third = await freshContext(browser, baseURL);
  const rookie = await third.newPage();
  await newAccount(rookie);
  const rookieSheet = await openChat(rookie);
  await expect(rookieSheet.getByRole('combobox', { name: 'Mensaje' })).toBeDisabled();
  await expect(rookieSheet.getByText('Necesitas nivel 5 para escribir')).toBeVisible();
  await expect(rookieSheet.getByRole('log').getByText(text)).toBeVisible();
  await expect(rookieSheet.getByRole('tab', { name: 'Clan' })).toHaveCount(0);
  await third.close();

  expect([...csp, ...readerCsp]).toEqual([]);
});
