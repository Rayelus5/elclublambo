import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Secret, TOTP } from 'otpauth';
import { expect, test } from './fixtures';
import { E2E_ENV } from '../playwright.config';

// The live config against the real server (GDD §16.3, §16.6; M6b), without publishing anything: the local database is
// the owner's, and publishing is covered by the integration tests on an in-memory config. A new admin opens
// Configuración; turning the market off with a wrong password is refused and nothing changes; a chat draft shows its
// issue by path and then what it would change; the history is there; the gacha simulator runs 10 000 pulls of the
// draft. No CSP violations. Writes an e2e_* admin only.
const cli = fileURLToPath(new URL('../../server/dist/cli.js', import.meta.url));

test('un admin revisa la configuración viva sin publicar nada', async ({ page }) => {
  test.setTimeout(120_000);
  const csp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  // Belt and braces: a publish that somehow got through would be refused here, never reach the database.
  await page.route('**/galaxy/api/admin/config/*', async (route) => {
    const body = route.request().postData() ?? '';
    if (route.request().method() === 'POST' && !body.includes('"password":"no-es-la-clave"')) await route.abort();
    else await route.continue();
  });

  const creds = JSON.parse(
    execFileSync('node', [cli, 'create-admin', `e2e_adm_${randomBytes(4).toString('hex')}`, '--role', 'admin', '--json'], {
      env: { ...process.env, ...E2E_ENV },
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .at(-1)!,
  ) as { username: string; password: string; totpSecret: string };
  await page.goto('/galaxy/entrar');
  await page.getByLabel('Usuario').fill(creds.username);
  await page.getByLabel('Contraseña', { exact: true }).fill(creds.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/galaxy\/verificar$/);
  await page.getByLabel('Código').fill(TOTP.generate({ secret: Secret.fromBase32(creds.totpSecret), algorithm: 'SHA1', digits: 6, period: 30 }));
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.locator('.hud').getByText(creds.username, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Administración' }).click();
  await page.getByRole('navigation', { name: 'Secciones del panel' }).getByRole('link', { name: 'Configuración' }).click();
  await expect(page).toHaveURL(/\/galaxy\/admin\/configuracion$/);

  // The market switch: a wrong password is refused and nothing changes.
  const settings = page.getByRole('region', { name: 'Ajustes del juego' });
  const featuresRow = settings.getByRole('listitem').filter({ has: page.getByRole('link', { name: /^Interruptores/ }) });
  const before = await featuresRow.locator('.cf-version').innerText();
  const market = page.getByRole('switch', { name: 'Mercado' });
  await expect(market).toBeChecked();
  await market.click();
  const dialog = page.getByRole('dialog', { name: 'Apagar Mercado' });
  await dialog.getByLabel('Motivo').fill('Prueba sin publicar');
  await dialog.getByLabel('Tu contraseña').fill('no-es-la-clave');
  await dialog.getByRole('button', { name: 'Apagar Mercado' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Esa no es tu contraseña');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(market).toBeChecked();
  await expect(featuresRow.locator('.cf-version')).toHaveText(before);

  // Each key is a form (polish phase 4): the field says what is wrong and «Qué cambia» speaks the form's words.
  await settings.getByRole('link', { name: /^Chat/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Chat' })).toBeVisible();
  const length = page.getByLabel('Caracteres por mensaje');
  const live = Number(await length.inputValue());
  await length.fill('5');
  const issues = page.getByRole('region', { name: 'Problemas' });
  await expect(issues).toContainText('Caracteres por mensaje');
  await expect(issues).toContainText('Demasiado pequeño');
  await expect(page.getByRole('button', { name: 'Publicar' })).toBeDisabled();
  const next = live === 300 ? 299 : 300;
  await length.fill(String(next));
  await expect(page.getByRole('region', { name: 'Qué cambia' })).toContainText(`Caracteres por mensaje pasa de ${live} a ${next}`);
  const history = page.getByRole('region', { name: 'Historial' });
  await expect(history.getByRole('button', { name: /^Cargar la versión/ }).first().or(history.getByText('Nunca se ha publicado', { exact: false }))).toBeVisible();

  // The gacha simulator pulls the draft in the browser.
  await page.getByRole('link', { name: 'Configuración' }).first().click();
  await settings.getByRole('link', { name: /^Escáner profundo/ }).click();
  await page.getByRole('button', { name: 'Tirar 10.000 veces' }).click();
  const table = page.getByRole('table', { name: 'Simulador del gachapón' });
  await expect(table.getByRole('rowheader', { name: 'Legendaria' })).toBeVisible();
  await expect(page.getByText('Una legendaria cada', { exact: false })).toBeVisible();
  expect(csp).toEqual([]);
});
