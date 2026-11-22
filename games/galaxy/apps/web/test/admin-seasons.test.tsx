import { type AdminSeason, type AdminSeasonList, CONFIG_KEYS, type MeResponse, parseConfig, seasonRecordIssues } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { afterEach, expect, test, vi } from 'vitest';
import { SeasonsScreen } from '../src/admin/seasons/SeasonsScreen';
import { SeasonWizardScreen } from '../src/admin/seasons/SeasonWizard';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// Temporadas in the admin panel (plan «temporadas como fichas», 2026-11-21): every season on one calendar with its
// warnings and actions, and the wizard that copies one from where it ends and saves or schedules it.
afterEach(() => vi.unstubAllGlobals());

const t = copy.admin.seasons;
const admin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const DAY = 86_400_000;
const { id: _i, name: _n, startsAt: _s, endsAt: _e, ...rules } = parseConfig('season', {});
const season = (over: Partial<AdminSeason>): AdminSeason => ({
  id: 'season-x',
  name: 'Temporada X',
  startsAt: '2026-11-12T23:00:00.000Z',
  endsAt: '2026-11-22T23:00:00.000Z',
  state: 'scheduled',
  open: false,
  version: 1,
  rules,
  route: parseConfig('seasonRoute', {}),
  missions: [],
  lab: [],
  ...over,
});
// Relative to now, so «open» and «scheduled» read right whatever day the test runs (Madrid midnights).
const midnight = (days: number) => {
  const d = new Date(Date.now() + days * DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 3_600_000).toISOString();
};
const S1 = season({ id: 'season-1', name: 'Temporada 1', state: 'closed', startsAt: midnight(-40), endsAt: midnight(-10) });
const S2 = season({ id: 'season-2', name: 'Temporada 2', state: 'scheduled', open: true, startsAt: midnight(-10), endsAt: midnight(5) });
const S3 = season({ id: 'season-3', name: 'Temporada 3', state: 'draft', startsAt: midnight(8), endsAt: midnight(40) });

/** `check`: what the server's validate answers (by default, the record's own checks, without what is live). */
function api(list: AdminSeasonList, me: MeResponse = admin, check: (record: unknown) => { path: string; message: string }[] = (r) => seasonRecordIssues(r)) {
  const calls: { path: string; body: unknown }[] = [];
  // As the server sends them: `content` is too big for the list (lazy) and comes on its own.
  const keys = CONFIG_KEYS.map((key) => (key === 'content' ? { key, version: 1, createdAt: null, author: null, note: null, lazy: true } : { key, version: 1, data: parseConfig(key, {}), createdAt: null, author: null, note: null }));
  const content = { key: 'content', version: 1, data: { ...parseConfig('content', DEFAULT_CONTENT), anomalies: [{ id: 'contagion', name: 'Corrosión contagiosa', description: 'x' }] }, createdAt: null, author: null, note: null };
  mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
    'GET /galaxy/api/admin/seasons': () => jsonResponse(200, list),
    'GET /galaxy/api/admin/config/keys': () => jsonResponse(200, keys),
    'GET /galaxy/api/admin/config/content': () => jsonResponse(200, content),
    // As the server checks it (here without what is live: the record's own checks).
    'POST /galaxy/api/admin/seasons/validate': (body) => {
      const issues = check((body as { record: unknown }).record);
      return jsonResponse(200, { ok: issues.length === 0, issues, big: [] });
    },
    'POST /galaxy/api/admin/seasons': (body) => {
      calls.push({ path: 'save', body });
      return jsonResponse(201, { ...S3, ...(body as { record: object }).record, state: 'draft' });
    },
    'POST /galaxy/api/admin/seasons/season-3/schedule': (body) => {
      calls.push({ path: 'schedule', body });
      return jsonResponse(200, { ...S3, state: 'scheduled' });
    },
    'POST /galaxy/api/admin/seasons/season-3/delete': (body) => {
      calls.push({ path: 'delete', body });
      return new Response(null, { status: 204 });
    },
    // Moving the open season's end, refused for what the new dates would break.
    'POST /galaxy/api/admin/seasons/season-2/extend': (body) => {
      calls.push({ path: 'extend', body });
      return jsonResponse(400, {
        error: 'season_invalid',
        issues: [
          { path: 'endsAt', message: 'season_cuts_tournament' },
          { path: 'route.steps.0.gifts.0', message: 'gift_event_closed' },
        ],
      });
    },
  });
  return calls;
}

test('el calendario agrupa las temporadas (abierta, borradores y pasadas) y avisa del hueco que viene', async () => {
  api({ seasons: [S1, S2, S3], now: new Date().toISOString(), warnings: [{ kind: 'gap', after: 'season-2', before: 'season-3', from: S2.endsAt, to: S3.startsAt }] });
  renderAt('/admin/temporadas', { '/admin/temporadas': <SeasonsScreen /> });
  const open = await screen.findByRole('region', { name: t.groups.open });
  expect(within(open).getByRole('heading', { name: 'Temporada 2' })).toBeInTheDocument();
  expect(within(open).getByRole('button', { name: t.actions.extend })).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: t.groups.draft })).getByRole('heading', { name: 'Temporada 3' })).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: t.groups.closed })).getByRole('heading', { name: 'Temporada 1' })).toBeInTheDocument();
  expect(screen.getByText(/no habrá ninguna temporada abierta/)).toBeInTheDocument();
  // «Nueva temporada» copies the last one that counts.
  expect(screen.getByRole('link', { name: t.create })).toHaveAttribute('href', '/admin/temporadas/nueva?desde=season-2');
});

test('mover el final dice en palabras lo que las fechas nuevas romperían', async () => {
  const user = userEvent.setup();
  const calls = api({ seasons: [S2, S3], now: new Date().toISOString(), warnings: [] });
  renderAt('/admin/temporadas', { '/admin/temporadas': <SeasonsScreen /> });
  const open = await screen.findByRole('region', { name: t.groups.open });
  await user.click(within(open).getByRole('button', { name: t.actions.extend }));
  const dialog = screen.getByRole('dialog');
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Una semana menos');
  await user.type(within(dialog).getByLabelText(copy.admin.fields.password), 'clave');
  await user.click(within(dialog).getByRole('button', { name: t.actions.extend }));
  await waitFor(() => expect(calls.map((c) => c.path)).toEqual(['extend']));
  expect(await within(dialog).findByText(t.issueText.season_cuts_tournament!)).toBeInTheDocument();
  expect(within(dialog).getByText(copy.gifts.issues.event_closed)).toBeInTheDocument();
  expect(within(dialog).queryByText('season_cuts_tournament')).not.toBeInTheDocument();
});

test('un borrador se borra con un motivo', async () => {
  const user = userEvent.setup();
  const calls = api({ seasons: [S2, S3], now: new Date().toISOString(), warnings: [] });
  renderAt('/admin/temporadas', { '/admin/temporadas': <SeasonsScreen /> });
  const drafts = await screen.findByRole('region', { name: t.groups.draft });
  await user.click(within(drafts).getByRole('button', { name: t.actions.remove }));
  const dialog = screen.getByRole('alertdialog');
  await user.type(within(dialog).getByLabelText(t.removeReason), 'Ya no hace falta');
  await user.click(within(dialog).getByRole('button', { name: t.actions.remove }));
  await waitFor(() => expect(calls).toEqual([{ path: 'delete', body: { reason: 'Ya no hace falta' } }]));
});

test('duplicar una temporada propone la siguiente: id y nombre nuevos, empieza donde acaba la otra y dura lo mismo', async () => {
  api({ seasons: [S1, S2], now: new Date().toISOString(), warnings: [] });
  renderAt('/admin/temporadas/nueva?desde=season-2', { '/admin/temporadas/:id': <SeasonWizardScreen /> });
  expect(await screen.findByLabelText(t.fields.name)).toHaveValue('Temporada 3');
  expect(screen.getByLabelText(t.fields.id)).toHaveValue('season-3');
  const length = Math.round((Date.parse(S2.endsAt) - Date.parse(S2.startsAt)) / DAY);
  expect(screen.getByText(t.days(length))).toBeInTheDocument();
});

test('guardar y programar: primero guarda el borrador, después lo programa con la contraseña', async () => {
  const user = userEvent.setup();
  const calls = api({ seasons: [S2, S3], now: new Date().toISOString(), warnings: [] });
  renderAt('/admin/temporadas/season-3', { '/admin/temporadas/:id': <SeasonWizardScreen />, '/admin/temporadas': <p>Lista</p> });
  await screen.findByLabelText(t.fields.name);
  await user.click(screen.getByRole('button', { name: new RegExp(t.steps.review) }));
  await user.type(screen.getAllByLabelText(copy.admin.fields.reason).at(-1)!, 'Temporada 3 a su hora');
  await user.type(screen.getByLabelText(copy.admin.fields.password), 'mi-clave');
  await waitFor(() => expect(screen.getByRole('button', { name: t.scheduleNow })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: t.scheduleNow }));
  await waitFor(() => expect(calls.map((c) => c.path)).toEqual(['save', 'schedule']));
  expect(calls[1]!.body).toEqual({ reason: 'Temporada 3 a su hora', password: 'mi-clave' });
  expect(await screen.findByText('Lista')).toBeInTheDocument();
});

test('una temporada programada se abre en el asistente y su anomalía sale con su nombre del contenido', async () => {
  const user = userEvent.setup();
  const S2p = season({ id: 'season-2', name: 'Temporada 2', state: 'scheduled', startsAt: midnight(1), endsAt: midnight(39), rules: { ...rules, anomaly: 'contagion' } });
  api({ seasons: [S1, S2p], now: new Date().toISOString(), warnings: [] });
  renderAt('/admin/temporadas/season-2', { '/admin/temporadas/:id': <SeasonWizardScreen /> });
  expect(await screen.findByText(t.readonly)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: new RegExp(t.steps.anomaly) }));
  expect(await screen.findByText('Corrosión contagiosa')).toBeInTheDocument();
});

test('los números del asistente usan el campo del panel (con decimales en español), no el del navegador', async () => {
  const user = userEvent.setup();
  api({ seasons: [S1, S2, S3], now: new Date().toISOString(), warnings: [] });
  renderAt('/admin/temporadas/season-3', { '/admin/temporadas/:id': <SeasonWizardScreen /> });
  await screen.findByLabelText(t.fields.name);
  await user.click(screen.getByRole('button', { name: new RegExp(t.steps.rules) }));
  expect(screen.queryAllByRole('spinbutton')).toEqual([]);
  expect(screen.getByLabelText(t.fields.layer)).toHaveAttribute('inputmode', 'decimal');
  await user.click(screen.getByRole('button', { name: new RegExp(t.steps.anomaly) }));
  expect(screen.queryAllByRole('spinbutton')).toEqual([]);
  // The default 0,02 shows as a percentage.
  expect(screen.getByLabelText(t.fields.finishChance)).toHaveValue('2');
});

test('una temporada programada o pasada se ve, pero no se cambia desde el asistente', async () => {
  api({ seasons: [S1, S2], now: new Date().toISOString(), warnings: [] });
  renderAt('/admin/temporadas/season-1', { '/admin/temporadas/:id': <SeasonWizardScreen /> });
  expect(await screen.findByText(t.closedNote)).toBeInTheDocument();
  expect(screen.getByLabelText(t.fields.name)).toBeDisabled();
  expect(screen.queryByRole('button', { name: t.saveDraft })).not.toBeInTheDocument();
});

test('cada temporada se puede ver como la verá un jugador: su tienda y su clasificación, en esta pestaña', async () => {
  api({ seasons: [S1, S2, S3], now: new Date().toISOString(), warnings: [] });
  renderAt('/admin/temporadas', { '/admin/temporadas': <SeasonsScreen /> });
  for (const [group, s] of [
    ['draft', S3],
    ['open', S2],
    ['closed', S1],
  ] as const) {
    const region = await screen.findByRole('region', { name: t.groups[group] });
    const shop = within(region).getByRole('link', { name: t.asPlayer.shop });
    expect(shop).toHaveAttribute('href', `/temporada?vista=${s.id}`);
    expect(shop).not.toHaveAttribute('target');
    expect(within(region).getByRole('link', { name: t.asPlayer.board })).toHaveAttribute('href', `/clasificacion?temporada=${s.id}`);
  }
});

test('la revisión del asistente lleva a verla como jugador; una nueva, primero se guarda', async () => {
  const user = userEvent.setup();
  api({ seasons: [S2, S3], now: new Date().toISOString(), warnings: [] });
  const view = renderAt('/admin/temporadas/season-3', { '/admin/temporadas/:id': <SeasonWizardScreen /> });
  await screen.findByLabelText(t.fields.name);
  await user.click(screen.getByRole('button', { name: new RegExp(t.steps.review) }));
  const as = screen.getByRole('region', { name: t.asPlayerTitle });
  expect(within(as).getByRole('link', { name: t.asPlayer.shop })).toHaveAttribute('href', '/temporada?vista=season-3');
  expect(within(as).getByRole('link', { name: t.asPlayer.board })).toHaveAttribute('href', '/clasificacion?temporada=season-3');
  expect(as).toHaveTextContent(t.asPlayerHint);
  view.unmount();

  renderAt('/admin/temporadas/nueva?desde=season-2', { '/admin/temporadas/:id': <SeasonWizardScreen /> });
  await screen.findByLabelText(t.fields.name);
  await user.click(screen.getByRole('button', { name: new RegExp(t.steps.review) }));
  const fresh = screen.getByRole('region', { name: t.asPlayerTitle });
  expect(within(fresh).queryByRole('link')).toBeNull();
  expect(fresh).toHaveTextContent(t.asPlayerSaveFirst);
});

// The editors of what a season pays (plan «temporadas como fichas», PR 4): every prize with the mail's gift picker, an
// old reward shown as its gifts (each part can be taken out), the closing prizes by place, live checks, and a season
// with big prizes only a superadmin schedules. All with the panel's own controls, never the browser's.
const small = (over: Partial<AdminSeason> = {}) =>
  season({ id: 'season-3', name: 'Temporada 3', state: 'draft', startsAt: midnight(8), endsAt: midnight(40), route: parseConfig('seasonRoute', { steps: [{ at: 100, reward: { coins: 300 } }], shop: [] }), ...over });
const toContent = async (user: ReturnType<typeof userEvent.setup>) => {
  await screen.findByLabelText(t.fields.name);
  await user.click(screen.getByRole('button', { name: new RegExp(t.steps.content) }));
};
const saveWith = async (user: ReturnType<typeof userEvent.setup>, reason: string) => {
  await user.type(screen.getByLabelText(copy.admin.fields.reason), reason);
  await user.click(screen.getByRole('button', { name: t.saveDraft }));
};
type Saved = { record: AdminSeason };

test('la ruta: lo de antes sale como regalos, se añade una sonda con el selector y se quita lo que sobra', async () => {
  const user = userEvent.setup();
  const calls = api({ seasons: [S2, small()], now: new Date().toISOString(), warnings: [] });
  renderAt('/admin/temporadas/season-3', { '/admin/temporadas/:id': <SeasonWizardScreen /> });
  await toContent(user);
  const step = within(screen.getByRole('list', { name: t.route.listLabel })).getAllByRole('listitem')[0]!;
  expect(within(step).getByText('300 monedas')).toBeInTheDocument();
  await user.click(within(step).getByRole('button', { name: t.gifts.addTo(t.route.step(1)) }));
  const dialog = screen.getByRole('dialog', { name: t.gifts.title(t.route.step(1)) });
  await user.click(within(dialog).getByRole('tab', { name: copy.gifts.tabs.probes }));
  await user.click(within(dialog).getByRole('button', { name: copy.gifts.addOf(copy.gifts.probe('Bastión')) }));
  await user.click(within(dialog).getByRole('button', { name: t.gifts.done }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(step).getByText('Sonda Bastión')).toBeInTheDocument();
  await user.click(within(step).getByRole('button', { name: t.gifts.remove('300 monedas') }));
  expect(within(step).queryByText('300 monedas')).toBeNull();
  await saveWith(user, 'Ruta con sonda');
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect((calls[0]!.body as Saved).record.route.steps).toEqual([{ at: 100, reward: { coins: 0, dust: 0, signal: 0, shards: 0, title: null, frame: null, avatar: null, skin: null }, gifts: [{ kind: 'probe', probe: 'bastion' }] }]);
});

test('un escalón nuevo va después del último, y los escalones se ordenan solos por sus puntos', async () => {
  const user = userEvent.setup();
  const calls = api({ seasons: [S2, small()], now: new Date().toISOString(), warnings: [] });
  renderAt('/admin/temporadas/season-3', { '/admin/temporadas/:id': <SeasonWizardScreen /> });
  await toContent(user);
  await user.click(screen.getByRole('button', { name: t.route.add }));
  const list = screen.getByRole('list', { name: t.route.listLabel });
  const second = within(list).getAllByLabelText(t.route.at)[1]!;
  expect(second).toHaveValue('200');
  // A step that gives nothing says so where it is.
  expect(within(list).getByText(t.issueText.season_reward_empty!)).toBeInTheDocument();
  await user.clear(second);
  await user.type(second, '50');
  await user.tab();
  expect(within(list).getAllByLabelText(t.route.at).map((i) => (i as HTMLInputElement).value)).toEqual(['50', '100']);
  // No native number fields anywhere in the step.
  expect(screen.queryAllByRole('spinbutton')).toEqual([]);
  expect(calls).toHaveLength(0);
});

test('la tienda: un artículo nuevo con su nombre, su precio y una galaxia', async () => {
  const user = userEvent.setup();
  const calls = api({ seasons: [S2, small()], now: new Date().toISOString(), warnings: [] });
  renderAt('/admin/temporadas/season-3', { '/admin/temporadas/:id': <SeasonWizardScreen /> });
  await toContent(user);
  await user.click(screen.getByRole('radio', { name: t.contentTabs.shop }));
  await user.click(screen.getByRole('button', { name: t.shop.add }));
  const item = within(screen.getByRole('list', { name: t.shop.listLabel })).getAllByRole('listitem')[0]!;
  await user.type(within(item).getByLabelText(t.shop.name), 'Galaxia de temporada');
  const price = within(item).getByLabelText(t.shop.price);
  await user.clear(price);
  await user.type(price, '250');
  await user.click(within(item).getByRole('button', { name: t.gifts.addTo('Galaxia de temporada') }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('tab', { name: copy.gifts.tabs.galaxies }));
  await user.click(within(dialog).getByRole('button', { name: copy.gifts.add }));
  await user.click(within(dialog).getByRole('button', { name: t.gifts.done }));
  await saveWith(user, 'Tienda con galaxia');
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect((calls[0]!.body as Saved).record.route.shop).toEqual([
    { id: 'articulo-1', name: 'Galaxia de temporada', price: 250, limit: 1, reward: { coins: 0, dust: 0, signal: 0, shards: 0, title: null, frame: null, avatar: null, skin: null }, gifts: [{ kind: 'galaxy', tier: 'epic', finish: 'normal', trait: null, count: 1 }] },
  ]);
});

test('los premios de cierre por puestos: un rango vacío o solapado se avisa en su sitio', async () => {
  const user = userEvent.setup();
  api({ seasons: [S2, small()], now: new Date().toISOString(), warnings: [] });
  renderAt('/admin/temporadas/season-3', { '/admin/temporadas/:id': <SeasonWizardScreen /> });
  await toContent(user);
  await user.click(screen.getByRole('radio', { name: t.contentTabs.closing }));
  // Every tier, Estelar first, with its old prize shown as gifts.
  expect(screen.getByRole('heading', { name: t.closing.tier('Estelar') })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: t.closing.add }));
  await user.click(screen.getByRole('button', { name: t.closing.add }));
  const places = screen.getByRole('region', { name: t.closing.placesTitle });
  expect(within(places).getAllByText(t.issueText.prize_empty!)).toHaveLength(2);
  const from = within(places).getAllByLabelText(t.closing.from)[1]!;
  expect(from).toHaveValue('2');
  await user.clear(from);
  await user.type(from, '1');
  expect(await within(places).findByText(t.issueText.prizes_overlap!)).toBeInTheDocument();
  // The issues list says where each one is, and leads there.
  expect(screen.getAllByText(t.closing.place(1, 1), { selector: '.sw-where' }).length).toBeGreaterThan(0);
});

test('copiar una temporada lleva su moneda propia en los premios a la nueva', async () => {
  const user = userEvent.setup();
  const own = { ...S2, route: parseConfig('seasonRoute', { shop: [{ id: 'chispa', name: 'Chispa', price: 1, limit: 1, gifts: [{ kind: 'currency', currency: 'season:season-2', amount: 5 }] }] }) };
  const calls = api({ seasons: [S1, own], now: new Date().toISOString(), warnings: [] });
  renderAt('/admin/temporadas/nueva?desde=season-2', { '/admin/temporadas/:id': <SeasonWizardScreen /> });
  await screen.findByLabelText(t.fields.name);
  await saveWith(user, 'Copia de la 2');
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect((calls[0]!.body as Saved).record.route.shop[0]!.gifts).toEqual([{ kind: 'currency', currency: 'season:season-3', amount: 5 }]);
});

test('las misiones y el laboratorio de temporada se editan con el formulario del panel', async () => {
  const user = userEvent.setup();
  const lab = [{ id: 't-hull', branch: 'probe', name: 'Casco de temporada', effect: { kind: 'stat', stat: 'maxHp' }, per: 0.02, max: 5, cost: { dust: 10, components: 0 }, requires: null, growth: 1 }];
  const calls = api({ seasons: [S2, small({ lab: lab as AdminSeason['lab'] })], now: new Date().toISOString(), warnings: [] });
  renderAt('/admin/temporadas/season-3', { '/admin/temporadas/:id': <SeasonWizardScreen /> });
  await toContent(user);
  await user.click(screen.getByRole('radio', { name: t.contentTabs.missions }));
  expect(screen.getByText(t.missionsEmpty)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Añadir misión' })).toBeInTheDocument();
  await user.click(screen.getByRole('radio', { name: t.contentTabs.lab }));
  expect(screen.getByRole('button', { name: 'Añadir nodo' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Casco de temporada/, expanded: false }));
  const name = screen.getByDisplayValue('Casco de temporada');
  await user.clear(name);
  await user.type(name, 'Casco helado');
  await saveWith(user, 'Laboratorio retocado');
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect((calls[0]!.body as Saved).record.lab).toEqual([{ ...lab[0], name: 'Casco helado' }]);
});

test('lo que el laboratorio de temporada tiene mal sale en su pestaña, dicho para un admin', async () => {
  const user = userEvent.setup();
  const lab = [{ id: 't-hull', branch: 'probe', name: 'Casco de temporada', effect: { kind: 'stat', stat: 'maxHp' }, per: 0.02, max: 5, cost: { dust: 10, components: 0 }, requires: 'no-existe', growth: 1 }];
  // The server checks the tree over the live permanent one: here, the requirement that is not in the tree.
  api({ seasons: [S2, small({ lab: lab as AdminSeason['lab'] })], now: new Date().toISOString(), warnings: [] }, admin, () => [{ path: 'lab', message: 'lab_requires:t-hull' }]);
  renderAt('/admin/temporadas/season-3', { '/admin/temporadas/:id': <SeasonWizardScreen /> });
  await toContent(user);
  // The tab says how many problems it has.
  await user.click(await screen.findByRole('radio', { name: `${t.contentTabs.lab} (1)` }));
  expect(await screen.findAllByText('El nodo «t-hull» necesita uno que no existe')).not.toHaveLength(0);
});

test('con premios grandes avisa por qué, y solo un superadmin la programa', async () => {
  const user = userEvent.setup();
  const big = small({ route: parseConfig('seasonRoute', { steps: [{ at: 100, gifts: [{ kind: 'probe', probe: 'bastion' }] }], shop: [] }) });
  api({ seasons: [S2, big], now: new Date().toISOString(), warnings: [] }, { ...admin, roles: ['admin'] });
  renderAt('/admin/temporadas/season-3', { '/admin/temporadas/:id': <SeasonWizardScreen /> });
  await screen.findByLabelText(t.fields.name);
  await user.click(screen.getByRole('button', { name: new RegExp(t.steps.review) }));
  const note = await screen.findByRole('region', { name: t.big.title });
  expect(note).toHaveTextContent(t.big.needs);
  expect(note).toHaveTextContent(t.route.step(1));
  expect(note).toHaveTextContent(copy.gifts.big.reasons.probe);
  await user.type(screen.getAllByLabelText(copy.admin.fields.reason).at(-1)!, 'Con una sonda');
  await user.type(screen.getByLabelText(copy.admin.fields.password), 'mi-clave');
  expect(screen.getByRole('button', { name: t.scheduleNow })).toBeDisabled();
});
