import { randomBytes } from 'node:crypto';
import { expect, skipTutorial, test } from './fixtures';

// A run against the real server (GDD §5.1): a new account takes the probe test (GDD §6, §12.2) and gets Bastión,
// scans its welcome galaxies, equips one as a relic in the hangar, picks the season's rift (M3b-3) and launches there,
// plays a few seconds with the keyboard, abandons from the pause menu and is paid half; the equipped galaxy cannot
// be disintegrated. Writes e2e_* accounts only.
const PASS = 'una-clave-larga-e2e';

test('del hangar a la arena y a los resultados, con una reliquia equipada', async ({ page }) => {
  test.setTimeout(120_000);
  const csp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  const username = `e2e_${randomBytes(4).toString('hex')}`;
  await page.goto('/galaxy/crear-cuenta');
  await page.getByLabel('Usuario').fill(username);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASS);
  await page.getByLabel('Repite la contraseña').fill(PASS);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  // The probe test comes right after the account: five questions with the number keys, all for Bastión.
  await expect(page).toHaveURL(/\/galaxy\/sonda$/);
  await page.getByRole('button', { name: 'Empezar' }).click();
  for (const [i, key] of ['2', '3', '1', '3', '1'].entries()) {
    await expect(page.getByText(`Pregunta ${i + 1} de 5`)).toBeVisible();
    await page.keyboard.press(key);
  }
  // Nothing is sent until it is confirmed.
  await page.getByRole('button', { name: 'Descubrir mi sonda' }).click();
  await expect(page.getByRole('heading', { name: 'Bastión' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Tu sonda')).toBeVisible();
  // The guided tour has its own test (tour.spec.ts).
  await skipTutorial(page);
  await page.goto('/galaxy/');

  // Ten welcome scans, so there are galaxies to equip.
  await page.getByRole('link', { name: /Escáner profundo/ }).click();
  await page.getByRole('button', { name: /Escanear 10.*10 señales/ }).click();
  const stage = page.getByRole('dialog', { name: 'Escaneo de campo profundo' });
  await expect(stage.locator('.crt-image[data-ready="true"]')).toBeAttached({ timeout: 20_000 });
  await stage.getByRole('button', { name: 'Saltar' }).click();
  await expect(stage.getByRole('article')).toHaveCount(10);
  await page.goto('/galaxy/');

  // Jugar opens the hangar (the lobby).
  await page.getByRole('link', { name: /Jugar/ }).click();
  await expect(page).toHaveURL(/\/galaxy\/incursion$/);
  await expect(page.getByRole('heading', { name: 'Nebulosa Exterior' })).toBeVisible();
  // The test's probe is equipped, on its pad; pressing it opens the workshop, which shows the eight: the other
  // starters wait for three runs, the five others for theirs.
  await expect(page.getByRole('heading', { name: 'Bastión' })).toBeVisible();
  await page.getByRole('link', { name: 'Abrir Bastión en el taller' }).click();
  await expect(page).toHaveURL(/\/galaxy\/taller/);
  const probes = page.getByRole('list', { name: 'Sondas' });
  await expect(probes.getByRole('listitem')).toHaveCount(8);
  await expect(probes.getByRole('button', { name: 'Bastión' })).toHaveAttribute('aria-pressed', 'true');
  await expect(probes.getByRole('button', { name: 'Bastión' })).toContainText('Equipada');
  await expect(probes.getByRole('progressbar', { name: 'Lumen' })).toHaveAttribute('aria-valuenow', '0');
  await expect(probes.getByText('Juega 3 incursiones')).toHaveCount(2);
  await page.getByRole('link', { name: /Volver/ }).click();
  await expect(page).toHaveURL(/\/galaxy\/incursion$/);
  // Sectors (M3b-3): five, the chain closed behind each Core, and the season open. The run goes to the rift.
  const sectors = page.getByRole('list', { name: 'Sectores' });
  await expect(sectors.getByRole('listitem')).toHaveCount(5);
  await expect(sectors.getByText(/^Derrota a /)).toHaveCount(3);
  await sectors.getByRole('button', { name: 'Fisura de la Señal' }).click();
  await expect(page.getByRole('heading', { name: 'Fisura de la Señal' })).toBeVisible();
  await expect(sectors.getByRole('button', { name: 'Fisura de la Señal' })).toHaveAttribute('aria-pressed', 'true');
  // The day's yield waits in Condiciones de hoy, over Lanzar.
  await page.getByRole('button', { name: /^Condiciones de hoy/ }).click();
  const today = page.getByRole('dialog', { name: 'Condiciones de hoy' });
  await expect(today.getByRole('region', { name: 'Premio del día' })).toContainText('Premio completo: te quedan 3 h 0 min hoy');
  await today.getByRole('button', { name: 'Cerrar' }).click();
  await expect(today).toHaveCount(0);

  // Equip the rarest galaxy in the first slot.
  await page.getByRole('button', { name: 'Elegir reliquia' }).first().click();
  const picker = page.getByRole('dialog', { name: 'Elige una reliquia' });
  await picker.getByRole('button', { name: /^Equipar / }).first().click();
  const slot = page.getByRole('group', { name: 'Ranura 1' });
  await expect(slot).toBeVisible();
  const relicName = (await slot.locator('.lobby-slot-name').textContent())!.trim();
  // Relic sets (M3b-1): their window opens from the slots, whatever this galaxy can make.
  await page.getByRole('button', { name: /^Conjuntos/ }).click();
  await expect(page.getByRole('region', { name: 'Conjuntos' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Conjuntos' })).toHaveCount(0);

  // Launch: the arena draws, the clock runs and the probe moves with the keyboard.
  await page.getByRole('button', { name: 'Lanzar incursión' }).click();
  await expect(page.locator('.arena-canvas')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('progressbar', { name: 'Vida' })).toBeVisible();
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyS');
  await expect(page.locator('.hud-time')).not.toHaveText('0:00');

  // Pause, abandon (it asks first), and the results pay half.
  await page.keyboard.press('Escape');
  const pause = page.getByRole('dialog', { name: 'Pausa' });
  await expect(pause).toBeVisible();
  await pause.getByRole('button', { name: 'Abandonar incursión' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Abandonar incursión' });
  await expect(confirm).toContainText('Se cobra la mitad del botín');
  await confirm.getByRole('button', { name: 'Abandonar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Incursión abandonada' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Sin extracción se cobra la mitad')).toBeVisible();

  // Another run starts from the hangar, which keeps the relic.
  await page.getByRole('button', { name: 'Otra incursión' }).click();
  await expect(page.getByRole('group', { name: 'Ranura 1' })).toContainText(relicName);

  // In the collection the equipped galaxy says so and cannot be disintegrated.
  await page.goto('/galaxy/coleccion');
  // Two galaxies of a scan can share a name: the equipped one is the one that says so.
  const card = page.getByRole('article', { name: relicName }).filter({ hasText: 'Equipada' });
  await expect(card).toHaveCount(1);
  await card.getByRole('link').click();
  const detail = page.getByRole('dialog', { name: relicName });
  await expect(detail.getByRole('button', { name: 'Desintegrar' })).toBeDisabled();
  await expect(detail).toContainText('Está equipada como reliquia en el hangar');
  expect(csp).toEqual([]);
});
