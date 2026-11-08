import type { ClanList, ClanView, GachaView, Leaderboard, MeResponse, Profile } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ClanScreen } from '../src/clans/ClanScreen';
import { ClansScreen } from '../src/clans/ClansScreen';
import { copy } from '../src/copy/es';
import { LeaderboardScreen } from '../src/social/LeaderboardScreen';
import { ProfileScreen } from '../src/social/ProfileScreen';
import { jsonResponse, locationOf, mockApi, renderAt } from './render';

// Clans (GDD §14.3, §14.1; M5b-1): the list with search, joining or asking to, and «Crear clan» with its cost and the
// level it needs; the creation dialog; a clan's page with what each role can do, confirmations for what cannot be
// undone; the Clanes tab of the leaderboard and the clan on a profile.
afterEach(() => vi.unstubAllGlobals());

const t = copy.clans;
const me = (level = 6): MeResponse => ({ id: 'a1', username: 'sonda_rayo', roles: [], mfa: false, level });
const gacha = (coins: number): GachaView => ({ banners: [], costs: { coins: 100, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins, dust: 0, signal: 0 } });
const rules = { maxMembers: 30, createCost: { coins: 2000 }, minLevel: 5 };
const list: ClanList = {
  clans: [
    { tag: 'GX', name: 'Galácticos', emblem: 'comet', color: 'uv', open: true, members: 12, maxMembers: 30, score: 4100 },
    { tag: 'NDU', name: 'Los Ñandúes', emblem: 'crown', color: 'solar', open: false, members: 22, maxMembers: 30, score: 900 },
  ],
  rules,
};
const clan = (over: Partial<ClanView> = {}): ClanView => ({
  tag: 'GX',
  name: 'Galácticos',
  description: 'Exploradores del borde',
  emblem: 'comet',
  color: 'uv',
  open: false,
  createdAt: '2026-11-08T10:00:00.000Z',
  maxMembers: 30,
  members: [
    { username: 'sonda_rayo', role: 'leader', level: 9, points: 900, joinedAt: '2026-11-08T10:00:00.000Z' },
    { username: 'vega', role: 'officer', level: 6, points: 400, joinedAt: '2026-11-08T11:00:00.000Z' },
    { username: 'lyra', role: 'member', level: 3, points: 120, joinedAt: '2026-11-08T12:00:00.000Z' },
  ],
  score: 1420,
  rank: 3,
  requests: ['deneb'],
  me: { role: 'leader' },
  ...over,
});
// Each test mounts the screen it checks: where a change leads shows in the location probe.
const listScreen = { '/clanes': <ClansScreen /> };
const clanScreen = { '/clanes/:tag': <ClanScreen /> };
const sent = (fetch: ReturnType<typeof mockApi>, path: string) => fetch.mock.calls.filter(([url, init]) => url === `/galaxy/api/clans${path}` && init?.method === 'POST');

function listApi(level = 6, coins = 5000, routes: Record<string, (b: unknown) => Response> = {}) {
  return mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, me(level)),
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha(coins)),
    'GET /galaxy/api/clans/mine': () => jsonResponse(200, null),
    'GET /galaxy/api/clans': () => jsonResponse(200, list),
    ...routes,
  });
}

test('la lista: cada clan con su emblema, miembros y puntos, y unirse o solicitar según sea abierto o cerrado', async () => {
  const fetch = listApi(6, 5000, { 'POST /galaxy/api/clans/GX/join': () => jsonResponse(200, clan({ me: { role: 'member' }, requests: undefined })) });
  const user = userEvent.setup();
  renderAt('/clanes', listScreen);
  const cards = await screen.findByRole('list', { name: t.title });
  const gx = within(cards).getByText('Galácticos').closest('li')!;
  expect(gx).toHaveTextContent('GX');
  expect(gx).toHaveTextContent(t.members(12, 30));
  expect(gx).toHaveTextContent(t.score(4100));
  expect(within(gx).getByRole('link', { name: /Galácticos/ })).toHaveAttribute('href', '/clanes/GX');
  const ndu = within(cards).getByText('Los Ñandúes').closest('li')!;
  expect(ndu).toHaveTextContent(t.closed);
  // Each card's button says which clan it acts on (review M5b-1).
  expect(within(ndu).getByRole('button', { name: t.requestTo('Los Ñandúes') })).toHaveTextContent(t.request);
  await user.click(within(gx).getByRole('button', { name: t.joinTo('Galácticos') }));
  await waitFor(() => expect(sent(fetch, '/GX/join')).toHaveLength(1));
  expect(locationOf(await screen.findByTestId('location')).pathname).toBe('/clanes/GX');
});

test('buscar pide la lista con su texto', async () => {
  const fetch = listApi(6, 5000, { 'GET /galaxy/api/clans?q=gal': () => jsonResponse(200, { clans: [list.clans[0]], rules }) });
  const user = userEvent.setup();
  renderAt('/clanes', listScreen);
  await screen.findByRole('list', { name: t.title });
  await user.type(screen.getByLabelText(t.searchLabel), 'gal');
  await waitFor(() => expect(fetch.mock.calls.map(([url]) => url)).toContain('/galaxy/api/clans?q=gal'));
  await waitFor(() => expect(within(screen.getByRole('list', { name: t.title })).getAllByRole('listitem')).toHaveLength(1));
});

test('crear un clan pide nivel y monedas, y dice cuál falta', async () => {
  const view = (() => {
    listApi(3, 5000);
    return renderAt('/clanes', listScreen);
  })();
  const low = await screen.findByRole('button', { name: new RegExp(t.create) });
  expect(low).toBeDisabled();
  expect(low).toHaveAccessibleDescription(t.needLevel(5));
  view.unmount();
  listApi(6, 100);
  renderAt('/clanes', listScreen);
  const poor = await screen.findByRole('button', { name: new RegExp(t.create) });
  await waitFor(() => expect(poor).toHaveAccessibleDescription(t.needCoins(2000)));
  expect(poor).toBeDisabled();
});

test('el diálogo de crear: nombre, etiqueta, descripción, emblema y color elegidos, y lleva al clan', async () => {
  const fetch = listApi(6, 5000, {
    'POST /galaxy/api/clans': () => jsonResponse(200, clan({ tag: 'HAL', name: 'Halcones', emblem: 'star', color: 'terminal', open: true })),
  });
  const user = userEvent.setup();
  renderAt('/clanes', listScreen);
  await user.click(await screen.findByRole('button', { name: new RegExp(t.create) }));
  const dialog = await screen.findByRole('dialog', { name: t.createTitle });
  expect(dialog).toHaveTextContent(t.cost(2000));
  expect(within(dialog).getByLabelText(t.name)).toHaveAccessibleDescription(t.nameHint);
  await user.type(within(dialog).getByLabelText(t.name), 'Halcones');
  await user.type(within(dialog).getByLabelText(t.tag), 'hal');
  await user.type(within(dialog).getByLabelText(t.description), 'Rápidos');
  expect(dialog).toHaveTextContent(t.count(7, 140));
  const emblems = within(dialog).getByRole('radiogroup', { name: t.emblem });
  expect(within(emblems).getAllByRole('radio')).toHaveLength(8);
  await user.click(within(emblems).getByRole('radio', { name: t.emblems.star }));
  await user.click(within(within(dialog).getByRole('radiogroup', { name: t.color })).getByRole('radio', { name: t.colors.terminal }));
  await user.click(within(dialog).getByRole('button', { name: t.submit }));
  await waitFor(() => expect(sent(fetch, '')).toHaveLength(1));
  const [, init] = sent(fetch, '')[0]!;
  expect(JSON.parse(String(init!.body))).toEqual({ name: 'Halcones', tag: 'HAL', description: 'Rápidos', emblem: 'star', color: 'terminal', open: true });
  expect((init!.headers as Record<string, string>)['idempotency-key']).toBeTruthy();
  expect(locationOf(await screen.findByTestId('location')).pathname).toBe('/clanes/HAL');
});

test('el líder ve las solicitudes y gestiona a cada miembro, con confirmación para expulsar', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/clans/GX': () => jsonResponse(200, clan()),
    'POST /galaxy/api/clans/GX/requests/deneb/accept': () => jsonResponse(200, clan({ requests: [] })),
    'POST /galaxy/api/clans/GX/members/lyra/kick': () => jsonResponse(200, clan({ members: clan().members.slice(0, 2) })),
    'POST /galaxy/api/clans/GX/members/lyra/promote': () => jsonResponse(200, clan()),
  });
  const user = userEvent.setup();
  renderAt('/clanes/GX', clanScreen);
  expect(await screen.findByRole('heading', { level: 1, name: 'Galácticos' })).toBeInTheDocument();
  expect(screen.getByText(t.rank(3))).toBeInTheDocument();
  const requests = screen.getByRole('region', { name: t.requestsTitle });
  await user.click(within(requests).getByRole('button', { name: t.accept('deneb') }));
  await waitFor(() => expect(sent(fetch, '/GX/requests/deneb/accept')).toHaveLength(1));

  const members = screen.getByRole('table', { name: t.membersTitle });
  const lyra = within(members).getByRole('link', { name: 'lyra' }).closest('tr')!;
  expect(lyra).toHaveTextContent(t.roles.member);
  expect(within(lyra).getByRole('button', { name: t.promote('lyra') })).toBeInTheDocument();
  expect(within(lyra).getByRole('button', { name: t.transfer('lyra') })).toBeInTheDocument();
  const vega = within(members).getByRole('link', { name: 'vega' }).closest('tr')!;
  expect(within(vega).getByRole('button', { name: t.demote('vega') })).toBeInTheDocument();
  // No actions on oneself.
  const self = within(members).getByRole('link', { name: 'sonda_rayo' }).closest('tr')!;
  expect(within(self).queryAllByRole('button')).toHaveLength(0);

  await user.click(within(lyra).getByRole('button', { name: t.kick('lyra') }));
  const confirm = await screen.findByRole('alertdialog', { name: t.kickTitle('lyra') });
  expect(sent(fetch, '/GX/members/lyra/kick')).toHaveLength(0);
  await user.click(within(confirm).getByRole('button', { name: t.kickConfirm }));
  await waitFor(() => expect(sent(fetch, '/GX/members/lyra/kick')).toHaveLength(1));
});

test('un oficial solo expulsa miembros y acepta; un miembro solo puede salir', async () => {
  mockApi({ 'GET /galaxy/api/clans/GX': () => jsonResponse(200, clan({ me: { role: 'officer' } })) });
  const view = renderAt('/clanes/GX', clanScreen);
  const members = await screen.findByRole('table', { name: t.membersTitle });
  const lyra = within(members).getByRole('link', { name: 'lyra' }).closest('tr')!;
  expect(within(lyra).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([t.kick('lyra')]);
  const leader = within(members).getByRole('link', { name: 'sonda_rayo' }).closest('tr')!;
  expect(within(leader).queryAllByRole('button')).toHaveLength(0);
  expect(screen.getByRole('region', { name: t.requestsTitle })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: t.edit })).toBeNull();
  view.unmount();

  mockApi({ 'GET /galaxy/api/clans/GX': () => jsonResponse(200, clan({ me: { role: 'member' }, requests: undefined })) });
  renderAt('/clanes/GX', clanScreen);
  const table = await screen.findByRole('table', { name: t.membersTitle });
  expect(within(table).queryAllByRole('button')).toHaveLength(0);
  expect(screen.queryByRole('region', { name: t.requestsTitle })).toBeNull();
  expect(screen.getByRole('button', { name: t.leave })).toBeInTheDocument();
});

test('salir confirma, y el último en salir ve que el clan se disolverá', async () => {
  const solo = clan({ members: [clan().members[0]!], requests: [] });
  const fetch = mockApi({
    'GET /galaxy/api/clans/GX': () => jsonResponse(200, solo),
    'POST /galaxy/api/clans/GX/leave': () => jsonResponse(200, null),
  });
  const user = userEvent.setup();
  renderAt('/clanes/GX', clanScreen);
  await user.click(await screen.findByRole('button', { name: t.leave }));
  const confirm = await screen.findByRole('alertdialog', { name: t.leaveTitle });
  expect(confirm).toHaveTextContent(t.disbandBody);
  await user.click(within(confirm).getByRole('button', { name: t.disband }));
  await waitFor(() => expect(sent(fetch, '/GX/leave')).toHaveLength(1));
  expect(locationOf(await screen.findByTestId('location')).pathname).toBe('/clanes');
});

test('quien no es del clan puede unirse o pedirlo, y cancelar su solicitud', async () => {
  let asked = true;
  const fetch = mockApi({
    'GET /galaxy/api/clans/GX': () => jsonResponse(200, clan({ me: asked ? { requested: true } : null, requests: undefined })),
    'POST /galaxy/api/clans/GX/request/cancel': () => {
      asked = false;
      return jsonResponse(200, clan({ me: null, requests: undefined }));
    },
  });
  const user = userEvent.setup();
  renderAt('/clanes/GX', clanScreen);
  expect(await screen.findByText(t.requested)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: t.cancelRequest }));
  await waitFor(() => expect(sent(fetch, '/GX/request/cancel')).toHaveLength(1));
  expect(await screen.findByRole('button', { name: t.request })).toBeInTheDocument();
});

test('la pestaña Clanes de la clasificación enseña los clanes con su emblema, y el perfil dice el clan', async () => {
  const board: Leaderboard = {
    season: { id: 'season-1', name: 'Temporada 1', startsAt: '2026-11-01T00:00:00.000Z', endsAt: new Date(Date.now() + 9 * 86_400_000).toISOString(), tiers: [500, 2000, 6000, 15000, 30000] },
    tab: 'clans',
    rows: [],
    me: null,
    total: 2,
    clans: [
      { rank: 1, tag: 'GX', name: 'Galácticos', emblem: 'comet', color: 'uv', members: 12, value: 4100 },
      { rank: 2, tag: 'NDU', name: 'Los Ñandúes', emblem: 'crown', color: 'solar', members: 30, value: 900 },
    ],
    myClan: { rank: 2, tag: 'NDU', name: 'Los Ñandúes', emblem: 'crown', color: 'solar', members: 30, value: 900 },
  };
  mockApi({
    'GET /galaxy/api/leaderboard?tab=clans': () => jsonResponse(200, board),
    'GET /galaxy/api/leaderboard?tab=general': () => jsonResponse(200, { ...board, tab: 'general', clans: undefined, myClan: undefined, total: 40 }),
  });
  const user = userEvent.setup();
  const view = renderAt('/clasificacion', { '/clasificacion': <LeaderboardScreen /> });
  await user.click(await screen.findByRole('link', { name: copy.social.tabs.clans }));
  const table = await screen.findByRole('table', { name: copy.social.tabs.clans });
  expect(within(table).getByRole('link', { name: 'Galácticos' })).toHaveAttribute('href', '/clanes/GX');
  expect(table.querySelector('tr[aria-current="true"]')).toHaveTextContent('Los Ñandúes');
  expect(table).toHaveTextContent(t.score(4100));
  view.unmount();

  const profile: Profile = {
    username: 'vega',
    since: '2026-11-03T10:00:00.000Z',
    level: 6,
    season: null,
    records: { maxDepth: 1, purges: 0, runs: 1 },
    collection: { total: 0, counts: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 } },
    planetarium: { prestige: 0, exhibits: 0, cover: null },
    clan: { tag: 'GX', name: 'Galácticos', emblem: 'comet', color: 'uv' },
  };
  mockApi({ 'GET /galaxy/api/profiles/vega': () => jsonResponse(200, profile) });
  renderAt('/perfil/vega', { '/perfil/:username': <ProfileScreen /> });
  expect(await screen.findByRole('link', { name: /Galácticos/ })).toHaveAttribute('href', '/clanes/GX');
});

test('quien ya está en otro clan no puede unirse y ve por qué (revisión M5b-1)', async () => {
  mockApi({
    'GET /galaxy/api/clans/GX': () => jsonResponse(200, clan({ me: null, requests: undefined, open: true })),
    'GET /galaxy/api/clans/mine': () => jsonResponse(200, clan({ tag: 'NDU', name: 'Los Ñandúes' })),
  });
  renderAt('/clanes/GX', clanScreen);
  const join = await screen.findByRole('button', { name: t.join });
  await waitFor(() => expect(join).toBeDisabled());
  expect(join).toHaveAccessibleDescription(t.inOtherClan);
});

test('los textos de expulsar y de salir dicen lo que pasa', () => {
  expect(t.kickBody).toBe('No podrá volver a entrar ni pedirlo hasta pasadas 24 horas');
  expect(t.leaderLeaveBody).toBe('El liderazgo pasará al oficial más antiguo o, si no hay, al miembro más antiguo');
  expect(copy.errors.clan_closed).toBe('Ese clan está cerrado. Pide entrar y espera a que te acepten');
});
