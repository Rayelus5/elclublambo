import { type AdminReferralCode, type AdminReferralOwner, type AdminReferralRow, type AdminReferralSummary, CONFIG_KEYS, type MeResponse, parseConfig } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ReferralsScreen } from '../src/admin/referrals/ReferralsScreen';
import { copy } from '../src/copy/es';
import { pickOption } from './pick';
import { jsonResponse, LocationProbe, locationOf, mockApi, renderAt } from './render';

// «Referidos» in the panel (plan «referidos», part R2): four tabs that live in the address; the summary with the live
// rules in words; the codes (create, turn off, copy the code or its link); the newcomers with their marks explained and
// the held ones approved or rejected with a reason; and the rewards, global (the live config) and an owner's own.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const t = copy.admin.referrals;
const admin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };

/** The live config, with the referrals' rules changed so the texts can only come from it. */
const referrals = parseConfig('referrals', { activationLevel: 7, newcomerGifts: { coins: 250 }, ownerGifts: { dust: 80, signal: 3 }, perCodePerDay: 12 });
const keys = CONFIG_KEYS.map((key) => ({ key, version: key === 'referrals' ? 2 : 0, data: key === 'referrals' ? referrals : parseConfig(key, {}), createdAt: null, author: null, note: null }));

const summary: AdminReferralSummary = { codes: { active: 3, total: 4 }, signups: { days7: 5, days30: 12, total: 20 }, activation: 0.45, held: 2, rewarded: 6 };
const VEGA = '0b3f6a52-6f5e-4a0e-9f63-0a1d2c3b4e5f';
const codes: AdminReferralCode[] = [
  { id: VEGA, code: 'VEGA-7K2P', owner: 'vega', enabled: true, maxUses: 50, expiresAt: null, note: 'Streamer', createdAt: '2026-11-10T10:00:00.000Z', createdBy: 'rayelus', uses: 12, rewarded: 4, held: 1 },
  { id: '5c1d7e2a-3b4c-4d5e-8f90-1a2b3c4d5e6f', code: 'ORION-AB12', owner: 'orion', enabled: false, maxUses: null, expiresAt: '2026-12-01T00:00:00.000Z', note: null, createdAt: '2026-11-09T10:00:00.000Z', createdBy: null, uses: 3, rewarded: 1, held: 0 },
];
const row = (over: Partial<AdminReferralRow>): AdminReferralRow => ({
  username: 'nova_01',
  code: 'VEGA-7K2P',
  owner: 'vega',
  createdAt: '2026-11-12T09:00:00.000Z',
  state: 'held',
  flags: ['owner_ip', 'ip_burst'],
  ip: '81.0.0.1',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  level: 3,
  activatedAt: null,
  newcomerPaid: false,
  ownerPaid: false,
  reviewedBy: null,
  ...over,
});
const rows = [row({}), row({ username: 'lyra_02', state: 'rewarded', flags: [], level: 9, newcomerPaid: true, ownerPaid: true, reviewedBy: null })];
const list = { rows, total: 2, page: 1, pages: 1 };

function api(routes: Record<string, (b: unknown) => Response> = {}) {
  return mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    'GET /galaxy/api/admin/config/keys': () => jsonResponse(200, keys),
    'GET /galaxy/api/admin/referrals/summary': () => jsonResponse(200, summary),
    'GET /galaxy/api/admin/referrals/codes': () => jsonResponse(200, codes),
    'GET /galaxy/api/admin/referrals?page=1': () => jsonResponse(200, list),
    ...routes,
  });
}
const sent = (fetch: ReturnType<typeof mockApi>, method: string, url: string) =>
  fetch.mock.calls.filter(([u, init]) => u === `/galaxy/api${url}` && init?.method === method).map(([, init]) => JSON.parse(String(init?.body)));
const open = (path = '/admin/referidos') =>
  renderAt(path, {
    '/admin/referidos': (
      <>
        <ReferralsScreen />
        <LocationProbe />
      </>
    ),
  });

test('las pestañas viven en la dirección y el resumen cuenta las cifras y las reglas vivas en palabras', async () => {
  api();
  const user = userEvent.setup();
  open();
  const tabs = await screen.findByRole('tablist', { name: t.tabsLabel });
  expect(within(tabs).getAllByRole('tab').map((x) => x.textContent)).toEqual([t.tabs.summary, t.tabs.codes, t.tabs.referrals, t.tabs.rewards]);
  expect(within(tabs).getByRole('tab', { name: t.tabs.summary })).toHaveAttribute('aria-selected', 'true');

  expect(await screen.findByRole('group', { name: t.tiles.codes })).toHaveTextContent('3');
  expect(screen.getByRole('group', { name: t.tiles.codes })).toHaveTextContent(t.tiles.codesOf(4));
  expect(screen.getByRole('group', { name: t.tiles.days7 })).toHaveTextContent('5');
  expect(screen.getByRole('group', { name: t.tiles.days30 })).toHaveTextContent('12');
  expect(screen.getByRole('group', { name: t.tiles.total })).toHaveTextContent('20');
  expect(screen.getByRole('group', { name: t.tiles.activation })).toHaveTextContent('45');
  expect(screen.getByRole('group', { name: t.tiles.held })).toHaveTextContent('2');
  expect(screen.getByRole('group', { name: t.tiles.rewarded })).toHaveTextContent('6');
  // The rules are the live ones (level 7, 250 coins), never written in the copy.
  const how = await screen.findByRole('region', { name: t.howTitle });
  expect(how).toHaveTextContent(t.how('250 monedas', 7, '80 de polvo estelar y 3 señales de galaxia'));
  expect(how).toHaveTextContent(t.howRequired(false));

  await user.click(within(tabs).getByRole('tab', { name: t.tabs.codes }));
  expect(within(tabs).getByRole('tab', { name: t.tabs.codes })).toHaveAttribute('aria-selected', 'true');
  expect(locationOf(screen.getByTestId('location')).search).toBe('?seccion=codigos');
  // «Revisar los retenidos» opens Referidos with the held ones.
  await user.click(within(tabs).getByRole('tab', { name: t.tabs.summary }));
  api({ 'GET /galaxy/api/admin/referrals?state=held&page=1': () => jsonResponse(200, { ...list, rows: [rows[0]], total: 1 }) });
  await user.click(await screen.findByRole('link', { name: t.tiles.review }));
  expect(within(tabs).getByRole('tab', { name: t.tabs.referrals })).toHaveAttribute('aria-selected', 'true');
  expect(locationOf(screen.getByTestId('location')).search).toBe('?seccion=referidos&estado=retenidos');
});

test('«Nuevo código» manda el dueño, su código, el tope, la caducidad, la nota y el motivo, y enseña el código creado', async () => {
  const fetch = api({
    'POST /galaxy/api/admin/referrals/codes': (b) => jsonResponse(200, { ...codes[0], id: 'c0ffee00-0000-4000-8000-000000000000', code: (b as { code: string }).code, uses: 0, rewarded: 0, held: 0 }),
  });
  const user = userEvent.setup();
  open('/admin/referidos?seccion=codigos');
  await user.click(await screen.findByRole('button', { name: t.create }));
  const dialog = await screen.findByRole('dialog', { name: t.create });
  await user.type(within(dialog).getByLabelText(t.fields.owner), 'Vega');
  await user.type(within(dialog).getByLabelText(t.fields.code), 'vega-amigos');
  await user.type(within(dialog).getByLabelText(t.fields.maxUses), '50');
  await user.type(within(dialog).getByLabelText(t.fields.expiresAt), '2026-12-31T23:59');
  await user.type(within(dialog).getByLabelText(t.fields.note), 'Streamer de otoño');
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Campaña de otoño');
  await user.click(within(dialog).getByRole('button', { name: t.create }));
  await waitFor(() =>
    expect(sent(fetch, 'POST', '/admin/referrals/codes')).toEqual([
      { owner: 'vega', code: 'VEGA-AMIGOS', maxUses: 50, expiresAt: new Date(2026, 11, 31, 23, 59).toISOString(), note: 'Streamer de otoño', reason: 'Campaña de otoño' },
    ]),
  );
  expect(await within(dialog).findByText(t.created('VEGA-AMIGOS'))).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: t.copyLinkOf('VEGA-AMIGOS') })).toBeInTheDocument();
});

test('un código mal escrito no deja crear, y vacío se manda sin él para que lo haga el servidor', async () => {
  const fetch = api({ 'POST /galaxy/api/admin/referrals/codes': () => jsonResponse(200, codes[0]) });
  const user = userEvent.setup();
  open('/admin/referidos?seccion=codigos');
  await user.click(await screen.findByRole('button', { name: t.create }));
  const dialog = await screen.findByRole('dialog', { name: t.create });
  await user.type(within(dialog).getByLabelText(t.fields.owner), 'vega');
  await user.type(within(dialog).getByLabelText(t.fields.code), 'no vale!');
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Campaña');
  expect(within(dialog).getByRole('button', { name: t.create })).toBeDisabled();
  await user.clear(within(dialog).getByLabelText(t.fields.code));
  await user.click(within(dialog).getByRole('button', { name: t.create }));
  await waitFor(() => expect(sent(fetch, 'POST', '/admin/referrals/codes')).toEqual([{ owner: 'vega', maxUses: null, expiresAt: null, note: null, reason: 'Campaña' }]));
});

test('la tabla de códigos dice usos, estado y quién lo creó, y apagar uno pide motivo y lo manda por PUT', async () => {
  const fetch = api({ [`PUT /galaxy/api/admin/referrals/codes/${VEGA}`]: () => jsonResponse(200, { ...codes[0], enabled: false }) });
  const user = userEvent.setup();
  open('/admin/referidos?seccion=codigos');
  const table = await screen.findByRole('table', { name: t.tabs.codes });
  const [vega, orion] = within(table).getAllByRole('row').slice(1);
  expect(vega).toHaveTextContent('VEGA-7K2P');
  expect(vega).toHaveTextContent(t.uses(12, 50));
  expect(vega).toHaveTextContent(t.codeStates.on);
  expect(vega).toHaveTextContent('rayelus');
  expect(within(vega!).getByRole('link', { name: 'vega' })).toHaveAttribute('href', '/admin/jugadores/vega');
  expect(orion).toHaveTextContent(t.uses(3, null));
  expect(orion).toHaveTextContent(t.codeStates.off);
  expect(within(orion!).getByRole('button', { name: t.turnOnOf('ORION-AB12') })).toBeInTheDocument();

  await user.click(within(vega!).getByRole('button', { name: t.turnOffOf('VEGA-7K2P') }));
  const dialog = await screen.findByRole('dialog', { name: t.turnOffOf('VEGA-7K2P') });
  expect(dialog).toHaveTextContent(t.turnOffIntro);
  expect(within(dialog).getByRole('button', { name: t.turnOff })).toBeDisabled();
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Lo pidió él');
  await user.click(within(dialog).getByRole('button', { name: t.turnOff }));
  await waitFor(() => expect(sent(fetch, 'PUT', `/admin/referrals/codes/${VEGA}`)).toEqual([{ enabled: false, reason: 'Lo pidió él' }]));
});

test('«Editar límites» parte de los de ahora y manda los tres, vacío como sin límite', async () => {
  const fetch = api({ [`PUT /galaxy/api/admin/referrals/codes/${VEGA}`]: () => jsonResponse(200, codes[0]) });
  const user = userEvent.setup();
  open('/admin/referidos?seccion=codigos');
  await user.click(await screen.findByRole('button', { name: t.editOf('VEGA-7K2P') }));
  const dialog = await screen.findByRole('dialog', { name: t.editOf('VEGA-7K2P') });
  const max = within(dialog).getByLabelText(t.fields.maxUses);
  expect(max).toHaveValue('50');
  expect(within(dialog).getByLabelText(t.fields.note)).toHaveValue('Streamer');
  await user.clear(max);
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Sin tope');
  await user.click(within(dialog).getByRole('button', { name: t.save }));
  await waitFor(() => expect(sent(fetch, 'PUT', `/admin/referrals/codes/${VEGA}`)).toEqual([{ maxUses: null, expiresAt: null, note: 'Streamer', reason: 'Sin tope' }]));
});

test('copiar el enlace copia la dirección de registro con el código; si el navegador no deja, el texto queda seleccionado', async () => {
  api();
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  open('/admin/referidos?seccion=codigos');
  await user.click(await screen.findByRole('button', { name: t.copyLinkOf('VEGA-7K2P') }));
  expect(write).toHaveBeenCalledWith(`${window.location.origin}/galaxy/crear-cuenta?ref=VEGA-7K2P`);
  expect(await screen.findByRole('button', { name: t.copyLinkOf('VEGA-7K2P') })).toHaveTextContent(copy.clipboard.copied);

  write.mockRejectedValue(new Error('denied'));
  await user.click(screen.getByRole('button', { name: t.copyCodeOf('VEGA-7K2P') }));
  const field = await screen.findByRole('textbox', { name: t.copyCodeOf('VEGA-7K2P') });
  expect(field).toHaveValue('VEGA-7K2P');
  expect(field).toHaveFocus();
  expect([(field as HTMLInputElement).selectionStart, (field as HTMLInputElement).selectionEnd]).toEqual([0, 'VEGA-7K2P'.length]);
  expect(field).toHaveAccessibleDescription(copy.clipboard.manual);
});

test('los referidos: estado, marcas explicadas, navegador legible, filtros en la dirección, y aprobar o rechazar con motivo', async () => {
  const fetch = api({
    'GET /galaxy/api/admin/referrals?state=held&page=1': () => jsonResponse(200, { ...list, rows: [rows[0]], total: 1 }),
    'GET /galaxy/api/admin/referrals?state=held&flagged=1&page=1': () => jsonResponse(200, { ...list, rows: [rows[0]], total: 1 }),
    'POST /galaxy/api/admin/referrals/nova_01/review': () => jsonResponse(200, { ok: true }),
  });
  const user = userEvent.setup();
  open('/admin/referidos?seccion=referidos');
  const table = await screen.findByRole('table', { name: t.tabs.referrals });
  const [nova, lyra] = within(table).getAllByRole('row').slice(1);
  expect(nova).toHaveTextContent(t.states.held);
  expect(nova).toHaveTextContent(t.browserOn('Chrome', 'Windows'));
  const chip = within(nova!).getByText(t.flags.owner_ip);
  expect(chip).toHaveAccessibleDescription(t.flagHelp.owner_ip);
  expect(within(nova!).getByText(t.flags.ip_burst)).toHaveAccessibleDescription(t.flagHelp.ip_burst);
  expect(lyra).toHaveTextContent(t.states.rewarded);
  expect(within(lyra!).queryByRole('button', { name: t.approveOf('lyra_02') })).toBeNull();

  await pickOption(user, screen.getByRole('combobox', { name: t.state }), t.states.held);
  await user.click(screen.getByRole('switch', { name: t.flaggedOnly }));
  await waitFor(() => expect(locationOf(screen.getByTestId('location')).search).toBe('?seccion=referidos&estado=retenidos&marcados=1'));
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => u === '/galaxy/api/admin/referrals?state=held&flagged=1&page=1')).toBe(true));

  const held = within(await screen.findByRole('table', { name: t.tabs.referrals })).getAllByRole('row')[1]!;
  await user.click(within(held).getByRole('button', { name: t.approveOf('nova_01') }));
  let dialog = await screen.findByRole('dialog', { name: t.approveOf('nova_01') });
  expect(dialog).toHaveTextContent(t.approveIntro);
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Son hermanos');
  await user.click(within(dialog).getByRole('button', { name: t.approve }));
  await waitFor(() => expect(sent(fetch, 'POST', '/admin/referrals/nova_01/review')).toEqual([{ decision: 'approve', reason: 'Son hermanos' }]));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  await user.click(within(within(await screen.findByRole('table', { name: t.tabs.referrals })).getAllByRole('row')[1]!).getByRole('button', { name: t.rejectOf('nova_01') }));
  dialog = await screen.findByRole('dialog', { name: t.rejectOf('nova_01') });
  expect(dialog).toHaveTextContent(t.rejectIntro);
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Cuenta secundaria');
  await user.click(within(dialog).getByRole('button', { name: t.reject }));
  await waitFor(() => expect(sent(fetch, 'POST', '/admin/referrals/nova_01/review')[1]).toEqual({ decision: 'reject', reason: 'Cuenta secundaria' }));
});

test('premios: las reglas globales vivas, el código obligatorio con motivo y contraseña, y el editor de la clave', async () => {
  const fetch = api({
    'POST /galaxy/api/admin/config/referrals': () => jsonResponse(201, { version: 3 }),
    'GET /galaxy/api/admin/config/referrals/versions': () => jsonResponse(200, []),
  });
  const user = userEvent.setup();
  open('/admin/referidos?seccion=premios');
  const global = await screen.findByRole('region', { name: t.globalTitle });
  expect(global).toHaveTextContent('250 monedas');
  expect(global).toHaveTextContent('80 de polvo estelar y 3 señales de galaxia');
  expect(global).toHaveTextContent(t.holds(12, 30, 3, 30)[0]!);
  const required = within(global).getByRole('switch', { name: t.required });
  expect(required).not.toBeChecked();
  await user.click(required);
  const dialog = await screen.findByRole('dialog', { name: t.requiredOn });
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Beta cerrada');
  await user.type(within(dialog).getByLabelText(copy.admin.fields.password), 'mi-clave');
  await user.click(within(dialog).getByRole('button', { name: t.requiredOn }));
  await waitFor(() => expect(sent(fetch, 'POST', '/admin/config/referrals')).toEqual([{ data: { required: true }, reason: 'Beta cerrada', password: 'mi-clave' }]));

  await user.click(within(global).getByRole('button', { name: t.editGlobal }));
  expect(await within(global).findByLabelText('Nivel de activación')).toHaveValue('7');
});

test('premios de un dueño: se busca, enseña lo suyo y lo global, y guarda con «Usar los globales» por campo', async () => {
  const owner: AdminReferralOwner = {
    owner: 'vega',
    override: { ownerGifts: { coins: 500 }, newcomerGifts: null, activationLevel: null },
    rules: { ownerGifts: { coins: 500 }, newcomerGifts: { coins: 250 }, activationLevel: 7 },
  };
  const fetch = api({
    'GET /galaxy/api/admin/referrals/owners/vega': () => jsonResponse(200, owner),
    'PUT /galaxy/api/admin/referrals/owners/vega': () => jsonResponse(200, owner),
  });
  const user = userEvent.setup();
  open('/admin/referidos?seccion=premios');
  const panel = await screen.findByRole('region', { name: t.ownerTitle });
  await user.type(within(panel).getByLabelText(t.ownerSearch), 'Vega');
  await user.click(within(panel).getByRole('button', { name: t.find }));
  expect(locationOf(screen.getByTestId('location')).search).toBe('?seccion=premios&dueno=vega');
  const effective = await within(panel).findByRole('region', { name: t.effective('vega') });
  expect(effective).toHaveTextContent('500 monedas');
  expect(effective).toHaveTextContent(t.own);
  expect(effective).toHaveTextContent(t.global);
  expect(panel).toHaveTextContent(t.replaceNote);

  const ownerGift = within(panel).getByRole('group', { name: t.ownerGift });
  expect(within(ownerGift).getByLabelText(copy.admin.communication.gifts.coins)).toHaveValue('500');
  await user.click(within(ownerGift).getByRole('switch', { name: t.useGlobalFor.ownerGifts }));
  const newcomer = within(panel).getByRole('group', { name: t.newcomerGift });
  await user.click(within(newcomer).getByRole('switch', { name: t.useGlobalFor.newcomerGifts }));
  const coins = within(newcomer).getByLabelText(copy.admin.communication.gifts.coins);
  await user.clear(coins);
  await user.type(coins, '300');
  const save = within(panel).getByRole('button', { name: t.saveOwner });
  expect(save).toBeDisabled();
  await user.type(within(panel).getByLabelText(copy.admin.fields.reason), 'Streamer');
  await user.click(save);
  await waitFor(() => expect(sent(fetch, 'PUT', '/admin/referrals/owners/vega')).toEqual([{ ownerGifts: null, newcomerGifts: { coins: 300 }, activationLevel: null, reason: 'Streamer' }]));
  expect(await within(panel).findByRole('status')).toHaveTextContent(t.savedOwner);
});
