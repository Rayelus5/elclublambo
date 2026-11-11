import { randomBytes } from 'node:crypto';
import { expect, test } from './fixtures';

// The guided tour against the real server (polish phase 3): a new account goes from its probe to the station's tour,
// PERKINS's cards move with «Siguiente» and with the player's own clicks (the Escáner), and «Saltar tutorial» ends
// it for good (a reload brings no card back). Writes e2e_* accounts only.
const PASS = 'una-clave-larga-e2e';

test('una cuenta nueva empieza el tour tras su sonda, lo sigue y lo puede saltar', async ({ page }) => {
  const username = `e2e_${randomBytes(4).toString('hex')}`;
  await page.goto('/galaxy/crear-cuenta');
  await page.getByLabel('Usuario').fill(username);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASS);
  await page.getByLabel('Repite la contraseña').fill(PASS);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/galaxy\/sonda$/);
  await page.getByRole('button', { name: 'Saltar el test' }).click();
  await page.getByRole('button', { name: 'Descubrir mi sonda' }).click();
  await page.getByRole('link', { name: 'Conocer la estación' }).click();

  const card = page.getByRole('dialog', { name: 'Tutorial' });
  await expect(card).toContainText('Soy PERKINS');
  for (const text of ['Aquí arriba están tus recursos', 'Jugar lanza una incursión', 'En la Estación reparas salas']) {
    await card.getByRole('button', { name: 'Siguiente' }).click();
    await expect(card).toContainText(text);
  }
  await card.getByRole('button', { name: 'Siguiente' }).click();
  // An action step leaves the target usable: the player opens the Escáner themselves.
  const action = page.getByRole('region', { name: 'Tutorial' });
  await expect(action).toContainText('Pulsa el Escáner.');
  await page.getByRole('link', { name: /^Escáner Obtén nuevas galaxias/ }).click();
  await expect(page).toHaveURL(/\/galaxy\/escaner$/);
  await expect(card).toContainText('probabilidades de cada rareza');
  await expect(page.getByRole('status').filter({ hasText: 'El inicio: hecho' })).toBeVisible();

  await card.getByRole('button', { name: 'Saltar tutorial' }).click();
  await page.getByRole('alertdialog', { name: '¿Saltar el tutorial?' }).getByRole('button', { name: 'Saltar', exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Escáner profundo', level: 1 })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Tutorial' })).toHaveCount(0);
});
