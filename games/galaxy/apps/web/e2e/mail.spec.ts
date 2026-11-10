import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Secret, TOTP } from 'otpauth';
import { type Page, expect, skipProbeTest, test } from './fixtures';
import { E2E_ENV } from '../playwright.config';

// Communication against the real server (GDD §4, §16.5; M6d-1). A new admin (CLI) sends a message with 100 coins to one
// new e2e player only (never to everyone: the local database is the owner's) and publishes a notice; the player sees
// the unread count on the mail button, opens the letter, collects the gift (the wallet grows) and sees the notice on
// the title screen. The notice is always ended at the end. No CSP violations.
const cli = fileURLToPath(new URL('../../server/dist/cli.js', import.meta.url));
const PASS = 'una-clave-larga-e2e';

/** A datetime-local value in this machine's time zone (the browser's). */
const local = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function watchCsp(page: Page): string[] {
  const csp: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) csp.push(msg.text());
  });
  return csp;
}

test('un admin envía un regalo a un jugador y publica un aviso; el jugador lo recoge y lo ve', async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000);
  const origin = new URL(baseURL!).origin;
  const b = randomBytes(3);
  const other = await browser.newContext({ baseURL, viewport: { width: 1600, height: 900 }, extraHTTPHeaders: { 'cf-connecting-ip': `10.${b[0]}.${b[1]}.${b[2]}` } });
  const player = await other.newPage();
  const playerCsp = watchCsp(player);
  const name = `e2e_${randomBytes(4).toString('hex')}`;
  await player.goto('/galaxy/crear-cuenta');
  await player.getByLabel('Usuario').fill(name);
  await player.getByLabel('Contraseña', { exact: true }).fill(PASS);
  await player.getByLabel('Repite la contraseña').fill(PASS);
  await player.getByRole('button', { name: 'Crear cuenta' }).click();
  await skipProbeTest(player);

  const csp = watchCsp(page);
  const creds = JSON.parse(
    execFileSync('node', [cli, 'create-admin', `e2e_adm_${randomBytes(4).toString('hex')}`, '--role', 'admin', '--json'], { env: { ...process.env, ...E2E_ENV }, encoding: 'utf8' }).trim().split('\n').at(-1)!,
  ) as { username: string; password: string; totpSecret: string };
  await page.goto('/galaxy/entrar');
  await page.getByLabel('Usuario').fill(creds.username);
  await page.getByLabel('Contraseña', { exact: true }).fill(creds.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/galaxy\/verificar$/);
  await page.getByLabel('Código').fill(TOTP.generate({ secret: Secret.fromBase32(creds.totpSecret), algorithm: 'SHA1', digits: 6, period: 30 }));
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.locator('.hud').getByText(creds.username, { exact: true })).toBeVisible();

  const noticeText = `Aviso de prueba ${randomBytes(3).toString('hex')}`;
  try {
    await page.goto('/galaxy/admin/comunicacion');
    // The message, to this player only, with 100 coins (the password, since it gives something).
    const compose = page.getByRole('form', { name: 'Enviar un mensaje' });
    await compose.getByLabel('Título').fill('Regalo de prueba');
    await compose.getByLabel('Mensaje', { exact: true }).fill('Gracias por probar el buzón');
    await compose.getByLabel('Para').selectOption('names');
    await compose.getByLabel('Cuentas').fill(name);
    await expect(compose.getByText('Llega a 1 cuenta')).toBeVisible();
    await compose.getByLabel('Monedas').fill('100');
    await compose.getByLabel('Motivo').fill('Prueba del buzón');
    await compose.getByLabel('Tu contraseña').fill(creds.password);
    await compose.getByRole('button', { name: 'Enviar a 1 cuenta' }).click();
    await expect(page.getByRole('status')).toHaveText('Enviado a 1 cuenta. Queda en la auditoría');

    // The notice, running now for an hour.
    const notice = page.getByRole('form', { name: 'Publicar un aviso' });
    await notice.getByLabel('Texto del aviso').fill(noticeText);
    await notice.getByLabel('Tono').selectOption('warning');
    await notice.getByLabel('Empieza').fill(local(Date.now() - 60_000));
    await notice.getByLabel('Termina').fill(local(Date.now() + 3_600_000));
    await notice.getByLabel('Motivo').fill('Prueba de avisos');
    await notice.getByRole('button', { name: 'Publicar aviso' }).click();
    await expect(notice.getByRole('status')).toHaveText('Aviso publicado. Queda en la auditoría');

    // The player: the notice behind Noticias (it says it is new), the unread count, the letter and its gift.
    const coinsBefore = ((await (await player.request.get('/galaxy/api/gacha')).json()) as { wallet: { coins: number } }).wallet.coins;
    await player.goto('/galaxy/');
    await expect(player.getByText(noticeText)).toHaveCount(0);
    await player.getByRole('button', { name: /^Noticias, \d+ nuevas?$/ }).click();
    const news = player.getByRole('dialog', { name: 'Noticias' });
    await expect(news.getByRole('region', { name: 'Avisos' }).getByText(noticeText)).toBeVisible();
    await news.getByRole('button', { name: 'Cerrar' }).click();
    await expect(news).toHaveCount(0);
    await player.getByRole('button', { name: 'Buzón, 1 sin leer' }).click();
    const box = player.getByRole('dialog', { name: 'Buzón' });
    await box.getByRole('button', { name: /Regalo de prueba/ }).click();
    await expect(box.getByRole('heading', { name: 'Regalo de prueba' })).toBeVisible();
    const gift = box.getByRole('region', { name: 'Regalo' });
    await expect(gift.getByText('100 monedas')).toBeVisible();
    await gift.getByRole('button', { name: 'Recoger' }).click();
    await expect(gift.getByRole('status')).toHaveText('Recogido');
    const coinsAfter = ((await (await player.request.get('/galaxy/api/gacha')).json()) as { wallet: { coins: number } }).wallet.coins;
    expect(coinsAfter - coinsBefore).toBe(100);
    await player.keyboard.press('Escape');
    await expect(player.getByRole('button', { name: 'Buzón', exact: true })).toBeVisible();
    expect(playerCsp).toEqual([]);
    expect(csp).toEqual([]);
  } finally {
    // Never leave the notice running on the owner's database.
    const list = (await (await page.request.get('/galaxy/api/admin/notices')).json()) as { id: string; text: string; endedAt: string | null }[];
    for (const n of list.filter((x) => x.text === noticeText && !x.endedAt)) {
      await page.request.post(`/galaxy/api/admin/notices/${n.id}/end`, { data: { reason: 'Fin de la prueba e2e' }, headers: { origin } });
    }
    await other.close();
  }
});
