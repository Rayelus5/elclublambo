import { type AdminSeason, type AdminSeasonList, CONFIG_KEYS, type MeResponse, parseConfig } from '@galaxy/shared';
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

function api(list: AdminSeasonList) {
  const calls: { path: string; body: unknown }[] = [];
  // As the server sends them: `content` is too big for the list (lazy) and comes on its own.
  const keys = CONFIG_KEYS.map((key) => (key === 'content' ? { key, version: 1, createdAt: null, author: null, note: null, lazy: true } : { key, version: 1, data: parseConfig(key, {}), createdAt: null, author: null, note: null }));
  const content = { key: 'content', version: 1, data: { ...parseConfig('content', DEFAULT_CONTENT), anomalies: [{ id: 'contagion', name: 'Corrosión contagiosa', description: 'x' }] }, createdAt: null, author: null, note: null };
  mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    'GET /galaxy/api/admin/seasons': () => jsonResponse(200, list),
    'GET /galaxy/api/admin/config/keys': () => jsonResponse(200, keys),
    'GET /galaxy/api/admin/config/content': () => jsonResponse(200, content),
    'POST /galaxy/api/admin/seasons/validate': () => jsonResponse(200, { ok: true, issues: [] }),
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
