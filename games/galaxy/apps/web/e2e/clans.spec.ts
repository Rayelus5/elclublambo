import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { type Page, expect, skipProbeTest, test } from './fixtures';
import { E2E_ENV } from '../playwright.config';

// Clans against the real server (GDD §14.3; M5b-1): a new account at level 6 (its experience set in its own row, as
// a minute-long run per level would be too long for an e2e) with coins from the CLI creates a closed clan from the
// dialog; a second account asks to join; the first accepts it and promotes it to officer; the second leaves; the
// first finds the Clanes tab. Writes e2e_* accounts only.
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

/** Level 6 for this e2e account: 1500 experience straight into its own row. */
async function levelUp(username: string) {
  const { Client } = createRequire(fileURLToPath(new URL('../../server/package.json', import.meta.url)))('pg') as { Client: new (o: { connectionString: string }) => PgClient };
  const db = new Client({ connectionString: E2E_ENV.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{ id: string }>('select id from galaxy.accounts where username = $1', [username]);
    await db.query('insert into galaxy.account_xp (account_id, xp) values ($1, 1500) on conflict (account_id) do update set xp = 1500', [rows[0]!.id]);
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

test('crear un clan cerrado, aceptar una solicitud, ascender, salir y verlo en la clasificación', async ({ page, baseURL, browser }) => {
  test.setTimeout(120_000);
  const csp = watchCsp(page);
  const leader = await newAccount(page);
  await levelUp(leader);
  execFileSync('node', [cli, 'grant', leader, 'coins', '2500', '--reason', 'e2e'], { env: { ...process.env, ...E2E_ENV } });

  // From the title screen's tile to the clans.
  await page.goto('/galaxy/');
  await page.getByRole('link', { name: /Clan/ }).click();
  await expect(page).toHaveURL(/\/galaxy\/clanes$/);
  const create = page.getByRole('button', { name: /Crear clan/ });
  await expect(create).toBeEnabled();
  await create.click();
  const dialog = page.getByRole('dialog', { name: 'Crear un clan' });
  const name = `Halcones ${randomBytes(2).toString('hex')}`;
  const tag = `E${randomBytes(1).toString('hex').toUpperCase()}`;
  await dialog.getByLabel('Nombre').fill(name);
  await dialog.getByLabel('Etiqueta').fill(tag.toLowerCase());
  await dialog.getByRole('radio', { name: 'Corona' }).check();
  await dialog.getByRole('radio', { name: 'Terminal' }).check();
  await dialog.getByRole('radio', { name: /Cerrado/ }).check();
  await expect(dialog).toContainText('Cuesta 2000 monedas');
  await dialog.getByRole('button', { name: 'Crear clan' }).click();
  await expect(page).toHaveURL(new RegExp(`/galaxy/clanes/${tag}$`));
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  // Someone asks to join; the leader accepts and promotes them.
  const b = randomBytes(3);
  const other = await browser.newContext({ baseURL, extraHTTPHeaders: { 'cf-connecting-ip': `10.${b[0]}.${b[1]}.${b[2]}` } });
  const member = await other.newPage();
  const memberCsp = watchCsp(member);
  const memberName = await newAccount(member);
  await member.goto(`/galaxy/clanes/${tag}`);
  await member.getByRole('button', { name: 'Solicitar' }).click();
  await expect(member.getByText('Solicitud enviada')).toBeVisible();

  await page.reload();
  await page.getByRole('region', { name: 'Solicitudes' }).getByRole('button', { name: `Aceptar a ${memberName}` }).click();
  const members = page.getByRole('table', { name: 'Miembros' });
  await expect(members.getByRole('link', { name: memberName })).toBeVisible();
  await members.getByRole('button', { name: `Ascender a ${memberName}` }).click();
  await expect(members.getByRole('link', { name: memberName }).locator('xpath=ancestor::tr')).toContainText('Oficial');

  // The officer leaves, confirming.
  await member.reload();
  await member.getByRole('button', { name: 'Salir del clan' }).click();
  await member.getByRole('alertdialog', { name: 'Salir del clan' }).getByRole('button', { name: 'Salir' }).click();
  await expect(member).toHaveURL(/\/galaxy\/clanes$/);
  await other.close();

  await page.reload();
  await expect(page.getByRole('table', { name: 'Miembros' }).getByRole('link', { name: memberName })).toHaveCount(0);
  await page.goto('/galaxy/clasificacion');
  await page.getByRole('navigation', { name: 'Pestañas de la clasificación' }).getByRole('link', { name: 'Clanes' }).click();
  await expect(page).toHaveURL(/pestana=clanes/);
  expect(csp).toEqual([]);
  expect(memberCsp).toEqual([]);
});
