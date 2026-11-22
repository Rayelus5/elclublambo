import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type AdminSeason, type AdminTournament, type AdminTournamentCash, type AdminTournamentReview, CONFIG_KEYS, type MeResponse, parseConfig, type TournamentRecord } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { AdminLayout } from '../src/admin/AdminLayout';
import { TournamentPage } from '../src/admin/tournaments/TournamentPage';
import { TournamentsScreen } from '../src/admin/tournaments/TournamentsScreen';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// Torneos in the admin panel (plan «temporadas como fichas», part 5): the list by state with what can be done to each,
// the money still to pay, the six-step wizard with the server's checks on its steps, and the review panel that decides
// on the runs that could not be checked, disqualifies and publishes.
afterEach(() => vi.unstubAllGlobals());

const t = copy.admin.tournaments;
const p = t.panel;
const superadmin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const plainAdmin: MeResponse = { id: 'ad2', username: 'vega', roles: ['admin'], mfa: true, level: 30 };
const DAY = 86_400_000;
const around = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const { id: _i, name: _n, startsAt: _s, endsAt: _e, ...rules } = parseConfig('season', {});
const season: AdminSeason = { id: 'season-2', name: 'Temporada 2', startsAt: around(-10), endsAt: around(30), state: 'scheduled', open: true, version: 1, rules, route: parseConfig('seasonRoute', {}), missions: [], lab: [] };

const ID = { draft: '11111111-1111-4111-8111-111111111111', scheduled: '22222222-2222-4222-8222-222222222222', full: '33333333-3333-4333-8333-333333333333', running: '44444444-4444-4444-8444-444444444444', review: '55555555-5555-4555-8555-555555555555', finished: '66666666-6666-4666-8666-666666666666', cancelled: '77777777-7777-4777-8777-777777777777' };
const RUN = '99999999-9999-4999-8999-999999999999';

const record = (over: Partial<TournamentRecord> = {}): TournamentRecord => ({
  slug: 'copa',
  seasonId: 'season-2',
  title: 'Copa del Vacío',
  summary: 'Una semana para llegar lo más hondo',
  rules: '',
  bannerMedia: null,
  detailsMedia: null,
  startsAt: around(2),
  endsAt: around(9),
  exclusive: true,
  metric: 'points',
  filters: { sector: null, probe: null, mode: 'any', minLevel: null },
  entry: null,
  prizes: [{ from: 1, to: 1, gifts: [{ kind: 'currency', currency: 'coins', amount: 5000 }], cash: null }],
  participation: null,
  reviewHours: 24,
  maxEntrants: null,
  ...over,
});
const tournament = (id: string, state: AdminTournament['state'], over: Partial<AdminTournament> = {}, rec: Partial<TournamentRecord> = {}): AdminTournament => ({
  id,
  state,
  version: 1,
  record: record(rec),
  createdAt: around(-3),
  createdBy: 'rayelus',
  updatedAt: around(-1),
  updatedBy: 'rayelus',
  scheduledAt: null,
  scheduledBy: null,
  publishedAt: null,
  entrants: 0,
  left: 0,
  disqualified: 0,
  pending: 0,
  undecided: 0,
  cashPending: 0,
  bigReasons: [],
  simVersion: null,
  simChanged: false,
  simVersions: [],
  ...over,
});

const list = [
  tournament(ID.draft, 'draft', { bigReasons: ['cash'] }, { title: 'Borrador de invierno', slug: 'invierno' }),
  tournament(ID.scheduled, 'scheduled', {}, { title: 'Copa del lunes', slug: 'lunes', entry: { currency: 'coins', amount: 500 } }),
  tournament(ID.full, 'scheduled', { entrants: 3 }, { title: 'Copa llena', slug: 'llena', entry: { currency: 'coins', amount: 500 } }),
  tournament(ID.running, 'running', { entrants: 12 }, { title: 'Carrera de Núcleos', slug: 'nucleos', metric: 'cores', startsAt: around(-2), endsAt: around(3) }),
  tournament(ID.review, 'review', { entrants: 20, pending: 2, undecided: 1 }, { title: 'Liga de otoño', slug: 'otono', startsAt: around(-9), endsAt: around(-1) }),
  tournament(ID.finished, 'finished', { entrants: 30, cashPending: 1, publishedAt: around(-2) }, { title: 'Gran Premio', slug: 'gran-premio', startsAt: around(-20), endsAt: around(-13) }),
  tournament(ID.cancelled, 'cancelled', {}, { title: 'Torneo cancelado', slug: 'cancelado', startsAt: around(-20), endsAt: around(-15) }),
];
const cash: AdminTournamentCash[] = [
  { tournamentId: ID.finished, slug: 'gran-premio', title: 'Gran Premio', username: 'orion', rank: 1, amountEur: 150, note: 'Bizum', paidAt: null, paidBy: null },
  { tournamentId: ID.finished, slug: 'gran-premio', title: 'Gran Premio', username: 'lyra', rank: 2, amountEur: 50, note: '', paidAt: around(-1), paidBy: 'rayelus' },
];

const keys = CONFIG_KEYS.map((key) => (key === 'content' ? { key, version: 1, createdAt: null, author: null, note: null, lazy: true } : { key, version: 1, data: parseConfig(key, {}), createdAt: null, author: null, note: null }));
const content = { key: 'content', version: 1, data: parseConfig('content', DEFAULT_CONTENT), createdAt: null, author: null, note: null };

type Call = { path: string; body: unknown };
function api(me: MeResponse = superadmin, extra: Record<string, (body: unknown) => Response> = {}) {
  const calls: Call[] = [];
  const log = (path: string, res: (body: unknown) => Response) => (body: unknown) => {
    calls.push({ path, body });
    return res(body);
  };
  const fetch = mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
    'GET /galaxy/api/admin/tournaments': () => jsonResponse(200, { tournaments: list, now: new Date().toISOString() }),
    'GET /galaxy/api/admin/tournaments/cash': () => jsonResponse(200, { cash }),
    'GET /galaxy/api/admin/seasons': () => jsonResponse(200, { seasons: [season], now: new Date().toISOString(), warnings: [] }),
    'GET /galaxy/api/admin/config/keys': () => jsonResponse(200, keys),
    'GET /galaxy/api/admin/config/content': () => jsonResponse(200, content),
    'GET /galaxy/api/content': () => jsonResponse(503, { error: 'internal' }),
    'GET /galaxy/api/profile/cosmetics': () => jsonResponse(200, {}),
    'GET /galaxy/api/admin/media': () => jsonResponse(200, { assets: [], totalBytes: 0 }),
    'POST /galaxy/api/admin/tournaments/validate': () => jsonResponse(200, { ok: true, issues: [], bigReasons: [] }),
    ...Object.fromEntries(list.map((x) => [`GET /galaxy/api/admin/tournaments/${x.id}`, () => jsonResponse(200, x)])),
    // Only the writes are logged.
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, k.startsWith('POST') ? log(k, v) : v])),
  });
  return { calls, fetch };
}

// ---------------------------------------------------------------------------------------------------------------------
// The list

test('la barra lateral lleva a Torneos', async () => {
  api();
  renderAt('/admin', { '/admin': <AdminLayout /> });
  const nav = await screen.findByRole('navigation', { name: copy.admin.nav });
  expect(within(nav).getByRole('link', { name: copy.admin.sections.tournaments })).toHaveAttribute('href', '/admin/torneos');
});

test('la lista agrupa los torneos por estado y da a cada uno sus acciones', async () => {
  api();
  renderAt('/admin/torneos', { '/admin/torneos': <TournamentsScreen /> });
  const drafts = await screen.findByRole('region', { name: t.groups.draft });
  const draft = within(drafts).getByRole('listitem', { name: 'Borrador de invierno' });
  expect(within(draft).getByRole('link', { name: t.actions.edit })).toHaveAttribute('href', `/admin/torneos/${ID.draft}`);
  expect(within(draft).getByRole('link', { name: t.actions.duplicate })).toHaveAttribute('href', `/admin/torneos/nuevo?desde=${ID.draft}`);
  // Scheduling goes through the wizard's review step.
  expect(within(draft).getByRole('link', { name: t.actions.schedule })).toHaveAttribute('href', `/admin/torneos/${ID.draft}?paso=revision`);
  expect(within(draft).getByRole('button', { name: t.actions.remove })).toBeInTheDocument();
  expect(within(draft).getByText(t.needsSuperadmin)).toBeInTheDocument();

  const scheduled = screen.getByRole('region', { name: t.groups.scheduled });
  const empty = within(scheduled).getByRole('listitem', { name: 'Copa del lunes' });
  expect(within(empty).getByRole('button', { name: t.actions.unschedule })).toBeInTheDocument();
  expect(within(empty).getByRole('button', { name: t.actions.cancel })).toBeInTheDocument();
  // With players in it, it can only be cancelled.
  const full = within(scheduled).getByRole('listitem', { name: 'Copa llena' });
  expect(within(full).queryByRole('button', { name: t.actions.unschedule })).not.toBeInTheDocument();
  expect(within(full).getByRole('button', { name: t.actions.cancel })).toBeInTheDocument();

  const running = within(screen.getByRole('region', { name: t.groups.running })).getByRole('listitem', { name: 'Carrera de Núcleos' });
  expect(within(running).getByRole('link', { name: t.actions.review })).toHaveAttribute('href', `/admin/torneos/${ID.running}`);
  expect(within(running).getByText(t.metrics.cores.name)).toBeInTheDocument();

  const review = within(screen.getByRole('region', { name: t.groups.review })).getByRole('listitem', { name: 'Liga de otoño' });
  expect(within(review).getByText(t.pendingChecks(2))).toBeInTheDocument();
  expect(within(review).getByText(t.undecidedChecks(1))).toBeInTheDocument();

  const finished = within(screen.getByRole('region', { name: t.groups.finished })).getByRole('listitem', { name: 'Gran Premio' });
  expect(within(finished).getByRole('link', { name: t.actions.results })).toHaveAttribute('href', `/admin/torneos/${ID.finished}`);
  expect(within(finished).queryByRole('button', { name: t.actions.cancel })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: t.groups.cancelled })).toBeInTheDocument();
});

test('un borrador se borra con un motivo', async () => {
  const user = userEvent.setup();
  const { calls } = api(superadmin, { [`POST /galaxy/api/admin/tournaments/${ID.draft}/delete`]: () => new Response(null, { status: 204 }) });
  renderAt('/admin/torneos', { '/admin/torneos': <TournamentsScreen /> });
  const draft = within(await screen.findByRole('region', { name: t.groups.draft })).getByRole('listitem', { name: 'Borrador de invierno' });
  await user.click(within(draft).getByRole('button', { name: t.actions.remove }));
  const dialog = screen.getByRole('alertdialog', { name: t.removeTitle('Borrador de invierno') });
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Ya no hace falta');
  await user.click(within(dialog).getByRole('button', { name: t.actions.remove }));
  await waitFor(() => expect(calls).toEqual([{ path: `POST /galaxy/api/admin/tournaments/${ID.draft}/delete`, body: { reason: 'Ya no hace falta' } }]));
  expect(await screen.findByText(t.done.removed('Borrador de invierno'))).toBeInTheDocument();
});

test('cancelar explica la devolución de la entrada y pide motivo y contraseña', async () => {
  const user = userEvent.setup();
  const { calls } = api(superadmin, { [`POST /galaxy/api/admin/tournaments/${ID.full}/cancel`]: () => jsonResponse(200, { ...list[2], state: 'cancelled', refunded: 3 }) });
  renderAt('/admin/torneos', { '/admin/torneos': <TournamentsScreen /> });
  const full = within(await screen.findByRole('region', { name: t.groups.scheduled })).getByRole('listitem', { name: 'Copa llena' });
  await user.click(within(full).getByRole('button', { name: t.actions.cancel }));
  const dialog = screen.getByRole('alertdialog', { name: t.cancelTitle('Copa llena') });
  expect(within(dialog).getByText(t.cancelRefund('500 monedas', 3))).toBeInTheDocument();
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Fallo del servidor');
  await user.type(within(dialog).getByLabelText(copy.admin.fields.password), 'mi-clave');
  await user.click(within(dialog).getByRole('button', { name: t.cancelButton }));
  await waitFor(() => expect(calls).toEqual([{ path: `POST /galaxy/api/admin/tournaments/${ID.full}/cancel`, body: { reason: 'Fallo del servidor', password: 'mi-clave' } }]));
  expect(await screen.findByText(t.done.cancelled('Copa llena', 3))).toBeInTheDocument();
});

test('desprogramar uno sin inscritos lo devuelve a borrador con motivo y contraseña', async () => {
  const user = userEvent.setup();
  const { calls } = api(superadmin, { [`POST /galaxy/api/admin/tournaments/${ID.scheduled}/unschedule`]: () => jsonResponse(200, { ...list[1], state: 'draft' }) });
  renderAt('/admin/torneos', { '/admin/torneos': <TournamentsScreen /> });
  const one = within(await screen.findByRole('region', { name: t.groups.scheduled })).getByRole('listitem', { name: 'Copa del lunes' });
  await user.click(within(one).getByRole('button', { name: t.actions.unschedule }));
  const dialog = screen.getByRole('alertdialog', { name: t.unscheduleTitle('Copa del lunes') });
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Cambio de fechas');
  await user.type(within(dialog).getByLabelText(copy.admin.fields.password), 'mi-clave');
  await user.click(within(dialog).getByRole('button', { name: t.actions.unschedule }));
  await waitFor(() => expect(calls[0]).toEqual({ path: `POST /galaxy/api/admin/tournaments/${ID.scheduled}/unschedule`, body: { reason: 'Cambio de fechas', password: 'mi-clave' } }));
});

test('los premios en metálico pendientes se marcan como pagados con motivo y contraseña', async () => {
  const user = userEvent.setup();
  const { calls } = api(superadmin, { [`POST /galaxy/api/admin/tournaments/${ID.finished}/cash/orion/paid`]: () => jsonResponse(200, { ...cash[0], paidAt: new Date().toISOString(), paidBy: 'rayelus' }) });
  renderAt('/admin/torneos', { '/admin/torneos': <TournamentsScreen /> });
  const section = await screen.findByRole('region', { name: t.cash.title });
  const row = within(section).getByRole('row', { name: /orion/ });
  expect(within(row).getByText('150,00 €')).toBeInTheDocument();
  // Writing to the winner opens Comunicación with them and the subject already there.
  expect(within(row).getByRole('link', { name: t.cash.writeTo('orion') })).toHaveAttribute('href', `/admin/comunicacion?para=orion&asunto=${encodeURIComponent(t.cash.subject('Gran Premio'))}`);
  // The paid one is not in the way.
  expect(within(section).queryByRole('button', { name: t.cash.markPaidOf('lyra') })).not.toBeInTheDocument();
  await user.click(within(row).getByRole('button', { name: t.cash.markPaidOf('orion') }));
  const dialog = screen.getByRole('alertdialog', { name: t.cash.paidTitle('orion') });
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Pagado por Bizum');
  await user.type(within(dialog).getByLabelText(copy.admin.fields.password), 'mi-clave');
  await user.click(within(dialog).getByRole('button', { name: t.cash.markPaid }));
  await waitFor(() => expect(calls).toEqual([{ path: `POST /galaxy/api/admin/tournaments/${ID.finished}/cash/orion/paid`, body: { reason: 'Pagado por Bizum', password: 'mi-clave' } }]));
  expect(await screen.findByText(t.done.paid('orion'))).toBeInTheDocument();
});

// ---------------------------------------------------------------------------------------------------------------------
// The wizard

const step = (name: string) => screen.getByRole('button', { name: new RegExp(`^\\d?\\s*${name}`) });

test('un torneo nuevo saca su dirección del título, cae en su temporada y se guarda como borrador', async () => {
  const user = userEvent.setup();
  const { calls } = api(superadmin, { 'POST /galaxy/api/admin/tournaments': (body) => jsonResponse(201, tournament('88888888-8888-4888-8888-888888888888', 'draft', {}, (body as { record: TournamentRecord }).record)) });
  renderAt('/admin/torneos/nuevo', { '/admin/torneos/:id': <TournamentPage />, '/admin/torneos': <p>Lista</p> });
  await user.type(await screen.findByLabelText(t.fields.title), 'Copa del Vacío');
  expect(screen.getByLabelText(t.fields.slug)).toHaveValue('copa-del-vacio');
  await user.click(step(t.steps.dates));
  expect(screen.getByText(new RegExp(`^Cae en ${season.name}`))).toBeInTheDocument();
  await user.type(screen.getByLabelText(copy.admin.fields.reason), 'Torneo de prueba');
  await user.click(screen.getByRole('button', { name: t.saveDraft }));
  await waitFor(() => expect(calls.map((c) => c.path)).toEqual(['POST /galaxy/api/admin/tournaments']));
  const sent = calls[0]!.body as { record: TournamentRecord; reason: string };
  expect(sent.reason).toBe('Torneo de prueba');
  expect(sent.record).toMatchObject({ title: 'Copa del Vacío', slug: 'copa-del-vacio', seasonId: 'season-2', metric: 'points', exclusive: true });
  expect(await screen.findByText('Lista')).toBeInTheDocument();
});

test('los problemas del servidor salen en su paso y llevan a él', async () => {
  const user = userEvent.setup();
  api(superadmin, {
    'POST /galaxy/api/admin/tournaments/validate': () =>
      jsonResponse(200, {
        ok: false,
        issues: [
          { path: 'prizes.0.from', message: 'prizes_start' },
          { path: 'startsAt', message: 'tournament_outside_season' },
        ],
        bigReasons: [],
      }),
  });
  renderAt(`/admin/torneos/${ID.draft}`, { '/admin/torneos/:id': <TournamentPage /> });
  await screen.findByLabelText(t.fields.title);
  await waitFor(() => expect(step(t.steps.prizes)).toHaveTextContent(t.problemsIn(t.steps.prizes, 1)));
  expect(step(t.steps.dates)).toHaveTextContent(t.problemsIn(t.steps.dates, 1));
  expect(step(t.steps.data)).not.toHaveTextContent(/problema/);
  await user.click(screen.getByRole('button', { name: copy.tournamentIssues.prizes_start }));
  expect(screen.getByRole('heading', { level: 2, name: t.steps.prizes })).toBeInTheDocument();
});

test('la entrada y el dinero nunca van juntos: con dinero no se cobra entrada', async () => {
  const user = userEvent.setup();
  api(superadmin, {
    [`GET /galaxy/api/admin/tournaments/${ID.draft}`]: () => jsonResponse(200, tournament(ID.draft, 'draft', {}, { prizes: [{ from: 1, to: 1, gifts: [], cash: { amountEur: 100, note: '' } }] })),
  });
  renderAt(`/admin/torneos/${ID.draft}`, { '/admin/torneos/:id': <TournamentPage /> });
  await screen.findByLabelText(t.fields.title);
  await user.click(step(t.steps.entry));
  expect(screen.getByRole('switch', { name: t.fields.fee })).toBeDisabled();
  expect(screen.getByText(t.feeBlocked)).toBeInTheDocument();
});

test('la entrada y el dinero nunca van juntos: con entrada no hay dinero en los premios', async () => {
  const user = userEvent.setup();
  api(superadmin, { [`GET /galaxy/api/admin/tournaments/${ID.draft}`]: () => jsonResponse(200, tournament(ID.draft, 'draft', {}, { entry: { currency: 'dust', amount: 50 } })) });
  renderAt(`/admin/torneos/${ID.draft}`, { '/admin/torneos/:id': <TournamentPage /> });
  await screen.findByLabelText(t.fields.title);
  await user.click(step(t.steps.prizes));
  expect(screen.getByRole('switch', { name: `${t.cashLabel} ${t.places(1, 1)}` })).toBeDisabled();
  expect(screen.getByText(t.cashBlocked)).toBeInTheDocument();
  // Turning the fee off frees the money.
  await user.click(step(t.steps.entry));
  await user.click(screen.getByRole('switch', { name: t.fields.fee }));
  await user.click(step(t.steps.prizes));
  expect(screen.getByRole('switch', { name: `${t.cashLabel} ${t.places(1, 1)}` })).toBeEnabled();
});

test('guardar y programar guarda el borrador a su versión y después lo programa con la versión nueva', async () => {
  const user = userEvent.setup();
  const draft = tournament(ID.draft, 'draft', { version: 3 });
  const { calls } = api(superadmin, {
    [`GET /galaxy/api/admin/tournaments/${ID.draft}`]: () => jsonResponse(200, draft),
    [`POST /galaxy/api/admin/tournaments/${ID.draft}`]: () => jsonResponse(200, { ...draft, version: 4 }),
    [`POST /galaxy/api/admin/tournaments/${ID.draft}/schedule`]: () => jsonResponse(200, { ...draft, version: 5, state: 'scheduled' }),
  });
  renderAt(`/admin/torneos/${ID.draft}?paso=revision`, { '/admin/torneos/:id': <TournamentPage />, '/admin/torneos': <p>Lista</p> });
  expect(await screen.findByRole('heading', { level: 2, name: t.steps.review })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: t.preview })).toHaveTextContent('Copa del Vacío');
  const schedule = screen.getByRole('region', { name: t.scheduleNow });
  await user.type(within(schedule).getByLabelText(copy.admin.fields.reason), 'Copa a su hora');
  await user.type(within(schedule).getByLabelText(copy.admin.fields.password), 'mi-clave');
  await waitFor(() => expect(within(schedule).getByRole('button', { name: t.scheduleNow })).toBeEnabled());
  await user.click(within(schedule).getByRole('button', { name: t.scheduleNow }));
  await waitFor(() => expect(calls.map((c) => c.path)).toEqual([`POST /galaxy/api/admin/tournaments/${ID.draft}`, `POST /galaxy/api/admin/tournaments/${ID.draft}/schedule`]));
  expect(calls[0]!.body).toMatchObject({ version: 3, reason: 'Copa a su hora' });
  expect(calls[1]!.body).toEqual({ version: 4, reason: 'Copa a su hora', password: 'mi-clave' });
  expect(await screen.findByText('Lista')).toBeInTheDocument();
});

test('unos premios grandes sin ser superadmin no se programan, y dice por qué', async () => {
  const draft = tournament(ID.draft, 'draft', { bigReasons: ['cash'] }, { prizes: [{ from: 1, to: 1, gifts: [], cash: { amountEur: 100, note: '' } }] });
  api(plainAdmin, {
    [`GET /galaxy/api/admin/tournaments/${ID.draft}`]: () => jsonResponse(200, draft),
    'POST /galaxy/api/admin/tournaments/validate': () => jsonResponse(200, { ok: true, issues: [], bigReasons: ['cash'] }),
  });
  renderAt(`/admin/torneos/${ID.draft}?paso=revision`, { '/admin/torneos/:id': <TournamentPage /> });
  await screen.findByRole('heading', { level: 2, name: t.steps.review });
  expect(await screen.findByText(t.bigNeeds)).toBeInTheDocument();
  expect(screen.getAllByText(t.bigCash).length).toBeGreaterThan(0);
  const schedule = screen.getByRole('region', { name: t.scheduleNow });
  expect(within(schedule).getByRole('button', { name: t.scheduleNow })).toBeDisabled();
});

test('si el servidor pide un superadmin al programar, lo dice con sus motivos', async () => {
  const user = userEvent.setup();
  const draft = tournament(ID.draft, 'draft');
  api(plainAdmin, {
    [`GET /galaxy/api/admin/tournaments/${ID.draft}`]: () => jsonResponse(200, draft),
    [`POST /galaxy/api/admin/tournaments/${ID.draft}`]: () => jsonResponse(200, { ...draft, version: 2 }),
    [`POST /galaxy/api/admin/tournaments/${ID.draft}/schedule`]: () => jsonResponse(403, { error: 'tournament_needs_superadmin', reasons: ['cash'] }),
  });
  renderAt(`/admin/torneos/${ID.draft}?paso=revision`, { '/admin/torneos/:id': <TournamentPage /> });
  await screen.findByRole('heading', { level: 2, name: t.steps.review });
  const schedule = screen.getByRole('region', { name: t.scheduleNow });
  await user.type(within(schedule).getByLabelText(copy.admin.fields.reason), 'Copa con dinero');
  await user.type(within(schedule).getByLabelText(copy.admin.fields.password), 'mi-clave');
  await waitFor(() => expect(within(schedule).getByRole('button', { name: t.scheduleNow })).toBeEnabled());
  await user.click(within(schedule).getByRole('button', { name: t.scheduleNow }));
  const alert = await within(schedule).findByRole('alert');
  expect(alert).toHaveTextContent(String(copy.errors.tournament_needs_superadmin));
  expect(alert).toHaveTextContent(t.bigCash);
});

test('duplicar propone una copia con su dirección libre que empieza donde acaba la otra', async () => {
  api();
  renderAt(`/admin/torneos/nuevo?desde=${ID.scheduled}`, { '/admin/torneos/:id': <TournamentPage /> });
  expect(await screen.findByLabelText(t.fields.title)).toHaveValue(t.copyOf('Copa del lunes'));
  expect(screen.getByLabelText(t.fields.slug)).toHaveValue('lunes-2');
});

test('un torneo programado se ve sin poder cambiarlo', async () => {
  api();
  renderAt(`/admin/torneos/${ID.scheduled}`, { '/admin/torneos/:id': <TournamentPage /> });
  expect(await screen.findByText(t.scheduledNote)).toBeInTheDocument();
  expect(screen.getByRole('region', { name: t.preview })).toHaveTextContent('Copa del lunes');
  expect(screen.queryByRole('button', { name: t.saveDraft })).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------------------------------------------------
// The review panel

const reviewOf = (over: Partial<AdminTournamentReview> = {}): AdminTournamentReview => ({
  tournament: list[4]!,
  ranking: [
    { rank: 1, username: 'orion', avatar: null, frame: null, score: 1240, eligible: true, place: 1, runs: 8, rewards: { place: 1, gifts: [{ kind: 'currency', currency: 'coins', amount: 5000 }], cash: null, participation: false } },
    { rank: 2, username: 'rayelus', avatar: null, frame: null, score: 900, eligible: false, place: null, runs: 5, rewards: null },
    { rank: 3, username: 'lyra', avatar: null, frame: null, score: 610, eligible: true, place: null, runs: 4, rewards: null },
  ],
  checks: [
    { runId: RUN, username: 'orion', finishedAt: around(-2), status: 'unverifiable', detail: { reason: 'sim_version' }, decision: null, decidedBy: null, decidedAt: null, checkedAt: around(-1), attempts: 1, current: true },
    { runId: '88888888-8888-4888-8888-888888888888', username: 'orion', finishedAt: around(-3), status: 'ok', detail: null, decision: null, decidedBy: null, decidedAt: null, checkedAt: around(-1), attempts: 1, current: true },
  ],
  disqualified: [{ username: 'nova', reason: 'Usaba un truco' }],
  publishAt: around(1),
  canPublish: false,
  blocking: 3,
  unverifiable: { byReason: [{ reason: 'sim_version', count: 1, blocking: 1 }], byPlayer: [{ username: 'orion', count: 1, blocking: 1 }] },
  cash: [],
  ...over,
});

test('la revisión enseña la clasificación congelada, quién no gana premios y no deja publicar con partidas pendientes', async () => {
  api(superadmin, { [`GET /galaxy/api/admin/tournaments/${ID.review}/review`]: () => jsonResponse(200, reviewOf()) });
  renderAt(`/admin/torneos/${ID.review}`, { '/admin/torneos/:id': <TournamentPage /> });
  const ranking = await screen.findByRole('region', { name: p.rankingTitle });
  expect(within(ranking).getByRole('row', { name: /orion/ })).toHaveTextContent(p.place(1));
  expect(within(ranking).getByRole('row', { name: /rayelus/ })).toHaveTextContent(p.notEligible);
  const checks = screen.getByRole('region', { name: p.checksTitle });
  expect(within(checks).getByText(p.reasons.sim_version!)).toBeInTheDocument();
  const publish = screen.getByRole('region', { name: p.publishNow });
  expect(within(publish).getByText(p.publishBlocked(3))).toBeInTheDocument();
  expect(within(publish).getByRole('button', { name: p.publishNow })).toBeDisabled();
});

test('aceptar una partida que no se puede comprobar pide motivo y contraseña', async () => {
  const user = userEvent.setup();
  const { calls } = api(superadmin, {
    [`GET /galaxy/api/admin/tournaments/${ID.review}/review`]: () => jsonResponse(200, reviewOf()),
    [`POST /galaxy/api/admin/tournaments/${ID.review}/checks/${RUN}/decide`]: () => jsonResponse(200, reviewOf()),
  });
  renderAt(`/admin/torneos/${ID.review}`, { '/admin/torneos/:id': <TournamentPage /> });
  const checks = await screen.findByRole('region', { name: p.checksTitle });
  // Only the one that waits for a decision has the buttons.
  expect(within(checks).getAllByRole('button', { name: p.acceptOf('orion') })).toHaveLength(1);
  await user.click(within(checks).getByRole('button', { name: p.acceptOf('orion') }));
  const dialog = screen.getByRole('alertdialog', { name: p.acceptTitle('orion') });
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Versión vieja, partida limpia');
  await user.type(within(dialog).getByLabelText(copy.admin.fields.password), 'mi-clave');
  await user.click(within(dialog).getByRole('button', { name: p.accept }));
  await waitFor(() => expect(calls).toEqual([{ path: `POST /galaxy/api/admin/tournaments/${ID.review}/checks/${RUN}/decide`, body: { decision: 'accept', reason: 'Versión vieja, partida limpia', password: 'mi-clave' } }]));
});

test('con todo resuelto se publica ya', async () => {
  const user = userEvent.setup();
  const done = reviewOf({ checks: [], canPublish: true, blocking: 0, tournament: { ...list[4]!, pending: 0, undecided: 0 } });
  const { calls } = api(superadmin, {
    [`GET /galaxy/api/admin/tournaments/${ID.review}/review`]: () => jsonResponse(200, done),
    [`POST /galaxy/api/admin/tournaments/${ID.review}/publish`]: () => jsonResponse(200, { ...done, canPublish: false, tournament: { ...done.tournament, state: 'finished' } }),
  });
  renderAt(`/admin/torneos/${ID.review}`, { '/admin/torneos/:id': <TournamentPage /> });
  const publish = await screen.findByRole('region', { name: p.publishNow });
  await user.type(within(publish).getByLabelText(copy.admin.fields.reason), 'Revisado a mano');
  await user.type(within(publish).getByLabelText(copy.admin.fields.password), 'mi-clave');
  await user.click(within(publish).getByRole('button', { name: p.publishNow }));
  await waitFor(() => expect(calls).toEqual([{ path: `POST /galaxy/api/admin/tournaments/${ID.review}/publish`, body: { reason: 'Revisado a mano', password: 'mi-clave' } }]));
  expect(await screen.findByText(t.done.published)).toBeInTheDocument();
});

test('descalificar y readmitir a un jugador', async () => {
  const user = userEvent.setup();
  const { calls } = api(superadmin, {
    [`GET /galaxy/api/admin/tournaments/${ID.review}/review`]: () => jsonResponse(200, reviewOf()),
    [`POST /galaxy/api/admin/tournaments/${ID.review}/entries/lyra/disqualify`]: () => jsonResponse(200, reviewOf()),
    [`POST /galaxy/api/admin/tournaments/${ID.review}/entries/nova/disqualify`]: () => jsonResponse(200, reviewOf()),
  });
  renderAt(`/admin/torneos/${ID.review}`, { '/admin/torneos/:id': <TournamentPage /> });
  const ranking = await screen.findByRole('region', { name: p.rankingTitle });
  await user.click(within(ranking).getByRole('button', { name: p.disqualifyOf('lyra') }));
  let dialog = screen.getByRole('alertdialog', { name: p.disqualifyTitle('lyra') });
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Cuenta compartida');
  await user.type(within(dialog).getByLabelText(copy.admin.fields.password), 'mi-clave');
  await user.click(within(dialog).getByRole('button', { name: p.disqualify }));
  await waitFor(() => expect(calls[0]).toEqual({ path: `POST /galaxy/api/admin/tournaments/${ID.review}/entries/lyra/disqualify`, body: { disqualified: true, reason: 'Cuenta compartida', password: 'mi-clave' } }));

  const out = screen.getByRole('region', { name: p.disqualifiedTitle });
  expect(within(out).getByText('Usaba un truco')).toBeInTheDocument();
  await user.click(within(out).getByRole('button', { name: p.requalifyOf('nova') }));
  dialog = screen.getByRole('alertdialog', { name: p.requalifyTitle('nova') });
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Era un error');
  await user.type(within(dialog).getByLabelText(copy.admin.fields.password), 'mi-clave');
  await user.click(within(dialog).getByRole('button', { name: p.requalify }));
  await waitFor(() => expect(calls[1]).toEqual({ path: `POST /galaxy/api/admin/tournaments/${ID.review}/entries/nova/disqualify`, body: { disqualified: false, reason: 'Era un error', password: 'mi-clave' } }));
});

test('las partidas que no se pueden comprobar se deciden en bloque por motivo, y dice cuántas se saltaron', async () => {
  const user = userEvent.setup();
  const run = (n: number, username: string, reason: string) => ({ runId: `9999999${n}-9999-4999-8999-999999999999`, username, finishedAt: around(-2), status: 'unverifiable' as const, detail: { reason }, decision: null, decidedBy: null, decidedAt: null, checkedAt: around(-1), attempts: 1, current: true });
  const view = reviewOf({
    checks: [run(1, 'orion', 'sim_version'), run(2, 'lyra', 'sim_version'), run(3, 'vega', 'sim_version'), run(4, 'vega', 'inputs_missing')],
    unverifiable: {
      byReason: [
        { reason: 'sim_version', count: 3, blocking: 2 },
        { reason: 'inputs_missing', count: 1, blocking: 0 },
      ],
      byPlayer: [
        { username: 'vega', count: 2, blocking: 1 },
        { username: 'orion', count: 1, blocking: 1 },
        { username: 'lyra', count: 1, blocking: 0 },
      ],
    },
  });
  const { calls } = api(superadmin, {
    [`GET /galaxy/api/admin/tournaments/${ID.review}/review`]: () => jsonResponse(200, view),
    [`POST /galaxy/api/admin/tournaments/${ID.review}/checks/decide-many`]: () => jsonResponse(200, { ...view, decided: 2, skipped: [{ runId: '99999992-9999-4999-8999-999999999999', username: 'lyra', why: 'staff_target' }] }),
  });
  renderAt(`/admin/torneos/${ID.review}`, { '/admin/torneos/:id': <TournamentPage /> });
  const checks = await screen.findByRole('region', { name: p.checksTitle });
  // By reason (3 for the simulation's version) and by player (vega, 2); a single run is decided in the table.
  expect(within(checks).getByRole('button', { name: p.discardAllOf('vega', 2) })).toBeInTheDocument();
  expect(within(checks).getByText(p.holding(2))).toBeInTheDocument();
  expect(within(checks).queryByRole('button', { name: p.acceptAllOf('orion', 1) })).not.toBeInTheDocument();
  await user.click(within(checks).getByRole('button', { name: p.acceptAllOf(p.reasons.sim_version!, 3) }));
  const dialog = screen.getByRole('alertdialog', { name: p.bulkAcceptTitle(3) });
  expect(dialog).toHaveTextContent(p.bulkAcceptText(3, p.bulkScopeReason(p.reasons.sim_version!)));
  await user.type(within(dialog).getByLabelText(copy.admin.fields.reason), 'Cambio de versión del lunes');
  await user.type(within(dialog).getByLabelText(copy.admin.fields.password), 'mi-clave');
  await user.click(within(dialog).getByRole('button', { name: p.acceptAll(3) }));
  await waitFor(() =>
    expect(calls).toEqual([{ path: `POST /galaxy/api/admin/tournaments/${ID.review}/checks/decide-many`, body: { decision: 'accept', filter: { reason: 'sim_version' }, reason: 'Cambio de versión del lunes', password: 'mi-clave' } }]),
  );
  expect(await screen.findByText(`${p.bulkDone(2)}. ${p.bulkSkipped(1)}`)).toBeInTheDocument();
});

test('si cambió la versión de la simulación durante el torneo, la lista y la revisión lo avisan', async () => {
  const changed = { ...list[4]!, simChanged: true };
  api(superadmin, {
    'GET /galaxy/api/admin/tournaments': () => jsonResponse(200, { tournaments: [changed], now: new Date().toISOString() }),
    [`GET /galaxy/api/admin/tournaments/${ID.review}`]: () => jsonResponse(200, changed),
    [`GET /galaxy/api/admin/tournaments/${ID.review}/review`]: () => jsonResponse(200, reviewOf({ tournament: changed })),
  });
  const view = renderAt('/admin/torneos', { '/admin/torneos': <TournamentsScreen /> });
  expect(await screen.findByText(t.simChanged)).toBeInTheDocument();
  view.unmount();
  renderAt(`/admin/torneos/${ID.review}`, { '/admin/torneos/:id': <TournamentPage /> });
  await screen.findByRole('region', { name: p.rankingTitle });
  expect(screen.getByText(t.simChanged)).toBeInTheDocument();
});

// The panel's own classes (atn-): the players' screens use tn-, and one sheet holds both (2026-11-22, `.tn-cash` of the
// players' € chip turned the panel's money section into a green pill).
test('el panel de torneos usa sus propias clases, que nunca pisan las de las pantallas del jugador', () => {
  const dir = resolve(process.cwd(), 'apps/web/src/admin/tournaments');
  for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/(?<![\w-])tn-/);
  // And the sheet styles them under their own name.
  const css = readFileSync(resolve(process.cwd(), 'apps/web/src/styles/app.css'), 'utf8');
  for (const name of ['atn-cash', 'atn-card', 'atn-chip', 'atn-ranking', 'atn-rules']) expect(css, name).toContain(`.${name} `);
});
