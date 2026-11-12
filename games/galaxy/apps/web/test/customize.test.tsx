import { type CosmeticsView, DEFAULT_COSMETICS, type MeResponse, type Profile } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { ProfileScreen } from '../src/social/ProfileScreen';
import { galaxy } from './hangar-fixtures';
import { pickOption } from './pick';
import { jsonResponse, mockApi, renderAt } from './render';

// «Personalizar» (Nov plan C2): on my own profile, an inventory of avatars, frames, titles and banners with a live
// preview; what I lack says how to get it (the shop's, a way to the shop); saving sends only what changed.
vi.mock('../src/galaxy/client', () => ({ requestGalaxy: vi.fn(() => new Promise(() => {})) }));
vi.mock('../src/galaxy/compose', () => ({ composeInto: vi.fn(() => 'webgl') }));
afterEach(() => vi.unstubAllGlobals());

const t = copy.customize;
const me: MeResponse = { id: 'a1', username: 'vega', roles: [], mfa: false, level: 7 };
const profile = (over: Partial<Profile> = {}): Profile => ({
  username: 'vega',
  since: '2026-11-03T10:00:00.000Z',
  level: 7,
  season: null,
  records: { maxDepth: 9, purges: 12, runs: 40 },
  collection: { total: 0, counts: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 } },
  planetarium: { prestige: 0, exhibits: 0, cover: null },
  clan: null,
  ...over,
});
const view = (over: Partial<CosmeticsView> = {}): CosmeticsView => ({
  equipped: { avatar: null, frame: null, title: 'Cadete', banner: null, backdrop: [] },
  owned: { avatars: ['portrait-hive'], frames: ['bronze'], titles: ['Cadete'] },
  catalog: DEFAULT_COSMETICS,
  ...over,
});
const screens = { '/perfil/:username': <ProfileScreen /> };
const base = {
  'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
  'GET /galaxy/api/profiles/vega': () => jsonResponse(200, profile({ title: 'Cadete' })),
  'GET /galaxy/api/profile/cosmetics': () => jsonResponse(200, view()),
  'GET /galaxy/api/galaxies?sort=rarity&limit=48': () => jsonResponse(200, { items: [], counts: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 }, fusion: { count: 3, dust: [] } }),
};

test('en mi perfil, «Personalizar» abre el inventario por pestañas; en el de otro no aparece', async () => {
  mockApi({ ...base, 'GET /galaxy/api/profiles/lyra': () => jsonResponse(200, profile({ username: 'lyra' })) });
  const user = userEvent.setup();
  renderAt('/perfil/vega', screens);
  await user.click(await screen.findByRole('button', { name: t.open }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  for (const tab of [t.tabs.avatar, t.tabs.frame, t.tabs.title, t.tabs.banner]) expect(within(dialog).getByRole('tab', { name: tab })).toBeInTheDocument();
  // Defaults are mine; a Núcleo portrait I earned too; one I lack is locked with how to get it.
  expect(await within(dialog).findByRole('radio', { name: /Gato de a bordo/ })).toBeEnabled();
  expect(within(dialog).getByRole('radio', { name: /La Colmena Rota/ })).toBeEnabled();
  const locked = within(dialog).getByRole('radio', { name: /La Madre Glaciar/ });
  expect(locked).toBeDisabled();
  expect(within(dialog).getByText('Vence a la Madre Glaciar por primera vez')).toBeInTheDocument();
  expect(within(dialog).getAllByRole('link', { name: t.inShop })[0]).toHaveAttribute('href', '/tienda?pestana=estilo');
});

test('no aparece en el perfil de otro jugador', async () => {
  mockApi({ ...base, 'GET /galaxy/api/profiles/lyra': () => jsonResponse(200, profile({ username: 'lyra' })) });
  renderAt('/perfil/lyra', screens);
  expect(await screen.findByRole('heading', { level: 1, name: 'lyra' })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('button', { name: t.open })).not.toBeInTheDocument());
});

test('elegir un avatar y un marco y guardar manda solo lo cambiado', async () => {
  const fetch = mockApi({ ...base, 'PUT /galaxy/api/profile/cosmetics': () => jsonResponse(200, view({ equipped: { avatar: 'crew-cat', frame: 'bronze', title: 'Cadete', banner: null, backdrop: [] } })) });
  const user = userEvent.setup();
  renderAt('/perfil/vega', screens);
  await user.click(await screen.findByRole('button', { name: t.open }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  await user.click(await within(dialog).findByRole('radio', { name: /Gato de a bordo/ }));
  await user.click(within(dialog).getByRole('tab', { name: t.tabs.frame }));
  await user.click(within(dialog).getByRole('radio', { name: /Bronce/ }));
  await user.click(within(dialog).getByRole('button', { name: t.save }));
  await waitFor(() => expect(fetch.mock.calls.some(([u, i]) => u === '/galaxy/api/profile/cosmetics' && i?.method === 'PUT')).toBe(true));
  const put = fetch.mock.calls.find(([u, i]) => u === '/galaxy/api/profile/cosmetics' && i?.method === 'PUT')!;
  expect(JSON.parse(String(put[1]?.body))).toEqual({ avatar: 'crew-cat', frame: 'bronze' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: t.title })).not.toBeInTheDocument());
});

test('quitar el título y volver a «Tu firma» se manda como null', async () => {
  const fetch = mockApi({ ...base, 'GET /galaxy/api/profile/cosmetics': () => jsonResponse(200, view({ equipped: { avatar: 'portrait-hive', frame: null, title: 'Cadete', banner: null, backdrop: [] } })), 'PUT /galaxy/api/profile/cosmetics': () => jsonResponse(200, view()) });
  const user = userEvent.setup();
  renderAt('/perfil/vega', screens);
  await user.click(await screen.findByRole('button', { name: t.open }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  await user.click(await within(dialog).findByRole('radio', { name: new RegExp(t.signature) }));
  await user.click(within(dialog).getByRole('tab', { name: t.tabs.title }));
  await user.click(within(dialog).getByRole('radio', { name: new RegExp(t.noTitle) }));
  await user.click(within(dialog).getByRole('button', { name: t.save }));
  await waitFor(() => expect(fetch.mock.calls.some(([u, i]) => u === '/galaxy/api/profile/cosmetics' && i?.method === 'PUT')).toBe(true));
  const put = fetch.mock.calls.find(([u, i]) => u === '/galaxy/api/profile/cosmetics' && i?.method === 'PUT')!;
  expect(JSON.parse(String(put[1]?.body))).toEqual({ avatar: null, title: null });
});

test('la pestaña «Banner» lista mis galaxias y guardar manda la elegida', async () => {
  const fetch = mockApi({
    ...base,
    'GET /galaxy/api/galaxies?sort=rarity&limit=48': () => jsonResponse(200, { items: [galaxy({ id: 'g1', name: 'Kathra' })], counts: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 1 }, fusion: { count: 3, dust: [] } }),
    'PUT /galaxy/api/profile/cosmetics': () => jsonResponse(200, view()),
  });
  const user = userEvent.setup();
  renderAt('/perfil/vega', screens);
  await user.click(await screen.findByRole('button', { name: t.open }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  await user.click(within(dialog).getByRole('tab', { name: t.tabs.banner }));
  await user.click(await within(dialog).findByRole('radio', { name: /Kathra/ }));
  await user.click(within(dialog).getByRole('button', { name: t.save }));
  await waitFor(() => expect(fetch.mock.calls.some(([u, i]) => u === '/galaxy/api/profile/cosmetics' && i?.method === 'PUT')).toBe(true));
  const put = fetch.mock.calls.find(([u, i]) => u === '/galaxy/api/profile/cosmetics' && i?.method === 'PUT')!;
  expect(JSON.parse(String(put[1]?.body))).toEqual({ banner: 'g1' });
});

test('la pestaña «Fondo» elige hasta 12 galaxias para el cielo del menú; las que no se ven bien no se pueden', async () => {
  const items = [galaxy({ id: 'g1', name: 'Kathra' }), galaxy({ id: 'g2', name: 'Orvel' }), galaxy({ id: 'g3', name: 'Blanca', traits: { ...galaxy().traits, palette: 'antimatter' } })];
  const fetch = mockApi({
    ...base,
    'GET /galaxy/api/profile/cosmetics': () => jsonResponse(200, view({ equipped: { avatar: null, frame: null, title: 'Cadete', banner: null, backdrop: ['g2'] } })),
    'GET /galaxy/api/galaxies?sort=rarity&limit=48': () => jsonResponse(200, { items, counts: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 3 }, fusion: { count: 3, dust: [] } }),
    'PUT /galaxy/api/profile/cosmetics': () => jsonResponse(200, view()),
  });
  const user = userEvent.setup();
  renderAt('/perfil/vega', screens);
  await user.click(await screen.findByRole('button', { name: t.open }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  await user.click(within(dialog).getByRole('tab', { name: t.tabs.backdrop }));
  const kathra = await within(dialog).findByRole('checkbox', { name: /Kathra/ });
  expect(within(dialog).getByRole('checkbox', { name: /Orvel/ })).toBeChecked();
  expect(within(dialog).getByRole('checkbox', { name: /Blanca/ })).toBeDisabled();
  expect(within(dialog).getByText(t.backdropCount(1))).toBeInTheDocument();
  await user.click(kathra);
  expect(within(dialog).getByText(t.backdropCount(2))).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: t.save }));
  await waitFor(() => expect(fetch.mock.calls.some(([u, i]) => u === '/galaxy/api/profile/cosmetics' && i?.method === 'PUT')).toBe(true));
  const put = fetch.mock.calls.find(([u, i]) => u === '/galaxy/api/profile/cosmetics' && i?.method === 'PUT')!;
  expect(JSON.parse(String(put[1]?.body))).toEqual({ backdrop: ['g2', 'g1'] });
});

test('«Usar las más raras» vacía la elección del fondo', async () => {
  const fetch = mockApi({
    ...base,
    'GET /galaxy/api/profile/cosmetics': () => jsonResponse(200, view({ equipped: { avatar: null, frame: null, title: 'Cadete', banner: null, backdrop: ['g2'] } })),
    'GET /galaxy/api/galaxies?sort=rarity&limit=48': () => jsonResponse(200, { items: [galaxy({ id: 'g2', name: 'Orvel' })], counts: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 1 }, fusion: { count: 3, dust: [] } }),
    'PUT /galaxy/api/profile/cosmetics': () => jsonResponse(200, view()),
  });
  const user = userEvent.setup();
  renderAt('/perfil/vega', screens);
  await user.click(await screen.findByRole('button', { name: t.open }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  await user.click(within(dialog).getByRole('tab', { name: t.tabs.backdrop }));
  await user.click(await within(dialog).findByRole('button', { name: t.backdropRarest }));
  await user.click(within(dialog).getByRole('button', { name: t.save }));
  await waitFor(() => expect(fetch.mock.calls.some(([u, i]) => u === '/galaxy/api/profile/cosmetics' && i?.method === 'PUT')).toBe(true));
  const put = fetch.mock.calls.find(([u, i]) => u === '/galaxy/api/profile/cosmetics' && i?.method === 'PUT')!;
  expect(JSON.parse(String(put[1]?.body))).toEqual({ backdrop: [] });
});

test('en la pestaña de títulos cada título sale una vez, con su rareza debajo si la tiene', async () => {
  mockApi(base);
  const user = userEvent.setup();
  renderAt('/perfil/vega', screens);
  await user.click(await screen.findByRole('button', { name: t.open }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  await user.click(within(dialog).getByRole('tab', { name: t.tabs.title }));
  const panel = within(dialog).getByRole('radiogroup', { name: t.tabs.title });
  const patron = within(panel).getByRole('radio', { name: /Mecenas estelar/ });
  expect(within(patron).getAllByText('Mecenas estelar')).toHaveLength(1);
  expect(within(patron).getByText(t.rarity.legendary!)).toBeInTheDocument();
  expect(within(within(panel).getByRole('radio', { name: /Cadete/ })).getAllByText('Cadete')).toHaveLength(1);
});

test('en mi perfil elijo cómo me llegan los avisos: «Silencio» se guarda en la cuenta', async () => {
  const friendsView = { friends: [], incoming: [], outgoing: [], blocked: [], prefs: { invites: 'friends', showStatus: true, notices: 'sound' }, max: 200 };
  const fetch = mockApi({
    ...base,
    'GET /galaxy/api/friends': () => jsonResponse(200, friendsView),
    'PUT /galaxy/api/friends/prefs': () => jsonResponse(200, { ...friendsView, prefs: { ...friendsView.prefs, notices: 'off' } }),
  });
  const user = userEvent.setup();
  renderAt('/perfil/vega', screens);
  const mode = await screen.findByRole('combobox', { name: copy.notices.mode });
  expect(mode).toHaveTextContent(copy.notices.modes.sound);
  await pickOption(user, mode, copy.notices.modes.off);
  await waitFor(() => expect(fetch.mock.calls.some(([u, i]) => u === '/galaxy/api/friends/prefs' && i?.method === 'PUT')).toBe(true));
  const put = fetch.mock.calls.find(([u, i]) => u === '/galaxy/api/friends/prefs' && i?.method === 'PUT')!;
  expect(JSON.parse(String(put[1]?.body))).toEqual({ invites: 'friends', showStatus: true, notices: 'off' });
  await waitFor(() => expect(screen.getByRole('combobox', { name: copy.notices.mode })).toHaveTextContent(copy.notices.modes.off));
});

test('en el perfil de otro no está el modo de avisos', async () => {
  mockApi({ ...base, 'GET /galaxy/api/profiles/lyra': () => jsonResponse(200, profile({ username: 'lyra' })) });
  renderAt('/perfil/lyra', screens);
  expect(await screen.findByRole('heading', { level: 1, name: 'lyra' })).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: copy.notices.mode })).not.toBeInTheDocument();
});
