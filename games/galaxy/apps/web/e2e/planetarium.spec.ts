import { randomBytes, randomUUID } from 'node:crypto';
import { type Page, expect, skipProbeTest, test } from './fixtures';

// The planetarium against the real server (GDD §10.5, §14.2; M4c-2): a new account exhibits two galaxies from its
// scan on the pedestals and sees its prestige; they show as «Expuesta» in its collection and cannot be disintegrated;
// a second account visits the planetarium by name, sees the two cards, and the visit counts once. Writes e2e_*
// accounts only.
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

test('exponer dos galaxias, verlas expuestas en la colección y recibir una visita', async ({ page, baseURL, browser }) => {
  const csp = watchCsp(page);
  const owner = await newAccount(page);
  const pull = await page.request.post('/galaxy/api/gacha/pull', {
    headers: { origin: baseURL!, 'idempotency-key': randomUUID() },
    data: { banner: 'deep-scan', count: 10, pay: 'signal' },
  });
  expect(pull.status()).toBe(200);

  // From the station's room to the dome.
  await page.goto('/galaxy/estacion');
  await page.getByRole('list', { name: 'Estación' }).getByRole('link', { name: /Planetario/ }).click();
  await expect(page).toHaveURL(/\/galaxy\/planetario$/);
  const pedestals = page.getByRole('list', { name: 'Pedestales' });
  await expect(pedestals.getByRole('button', { name: /^Exponer galaxia en el pedestal/ })).toHaveCount(6);
  await expect(page.getByText('Expón tus mejores galaxias en los pedestales. Cuanto más raras, más prestigio')).toBeVisible();

  for (const n of [1, 2]) {
    await pedestals.getByRole('button', { name: `Exponer galaxia en el pedestal ${n}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Elige una galaxia para exponer' });
    await dialog.locator('button.gcard-hit:enabled').first().click();
    await expect(dialog).toBeHidden();
    await expect(pedestals.getByRole('button', { name: /^Retirar / })).toHaveCount(n);
  }
  const prestige = page.getByRole('region', { name: 'Prestigio' });
  await expect(prestige.locator('.prestige-value')).not.toHaveText('0');
  await expect(prestige).toContainText('de experiencia en las incursiones');
  await expect(prestige).toContainText('0 visitas');

  // In the collection they are on display and cannot be disintegrated.
  await page.goto('/galaxy/coleccion');
  const shown = page.locator('.card-grid li', { has: page.getByText('Expuesta', { exact: true }) });
  await expect(shown).toHaveCount(2);
  await shown.first().getByRole('link').click();
  const detail = page.getByRole('dialog');
  await expect(detail.getByRole('button', { name: 'Desintegrar' })).toBeDisabled();
  await expect(detail).toContainText('Está expuesta en tu planetario');
  await page.keyboard.press('Escape');

  // Someone else visits it by name.
  const b = randomBytes(3);
  const other = await browser.newContext({ baseURL, extraHTTPHeaders: { 'cf-connecting-ip': `10.${b[0]}.${b[1]}.${b[2]}` } });
  const visitor = await other.newPage();
  const visitorCsp = watchCsp(visitor);
  await newAccount(visitor);
  await visitor.goto('/galaxy/planetario');
  await visitor.getByLabel('Nombre del jugador').fill(owner.toUpperCase());
  await visitor.getByRole('button', { name: 'Visitar' }).click();
  await expect(visitor.getByRole('heading', { level: 1, name: `Planetario de ${owner}` })).toBeVisible();
  const theirs = visitor.getByRole('list', { name: 'Pedestales' });
  await expect(theirs.getByRole('article')).toHaveCount(2);
  await expect(theirs.getByRole('button')).toHaveCount(0);
  await expect(visitor.getByRole('region', { name: 'Prestigio' })).toContainText('1 visita');
  // Coming back the same day does not count again.
  await visitor.reload();
  await expect(visitor.getByRole('region', { name: 'Prestigio' })).toContainText('1 visita');
  // A name without a planetarium says so.
  await visitor.goto('/galaxy/planetario/nadie_aqui_e2e');
  await expect(visitor.getByText('No hay ningún planetario con ese nombre')).toBeVisible();
  await other.close();

  await page.goto('/galaxy/planetario');
  await expect(page.getByRole('region', { name: 'Prestigio' })).toContainText('1 visita');
  expect(csp).toEqual([]);
  expect(visitorCsp).toEqual([]);
});
