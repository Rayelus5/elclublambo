import type { Profile, PublicCollectionPage, PublicGalaxy } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { ProfileScreen } from '../src/social/ProfileScreen';
import { PublicCollectionScreen } from '../src/social/PublicCollectionScreen';
import { jsonResponse, mockApi, renderAt } from './render';

// Public profiles and collections (GDD §14.2, §12.1; M5a): a player's level and since when, their season with its
// tier, their records, their collection by rarity with a way into it, and their planetarium with a way to visit it;
// their collection without any action, filtered by rarity and paged.
afterEach(() => vi.unstubAllGlobals());

const t = copy.social;
const pub = (over: Partial<PublicGalaxy> = {}): PublicGalaxy => ({
  id: 'g1',
  seed: '12345',
  tier: 'legendary',
  finish: 'holo',
  traits: { galaxy_type: 'spiral', palette: 'solar_gold' },
  name: 'Kathra',
  designation: 'GX-ABCDEF',
  featured: false,
  level: 2,
  ...over,
});
const profile = (over: Partial<Profile> = {}): Profile => ({
  username: 'vega',
  since: '2026-11-03T10:00:00.000Z',
  level: 7,
  season: { score: 2400, rank: 4, tier: 'silver', maxDepth: 6, purges: 3, extractions: 5 },
  records: { maxDepth: 9, purges: 12, runs: 40 },
  collection: { total: 23, counts: { common: 10, uncommon: 6, rare: 4, epic: 2, legendary: 1 } },
  planetarium: { prestige: 31, exhibits: 4, cover: pub() },
  clan: null,
  ...over,
});
const screens = { '/perfil/:username': <ProfileScreen />, '/perfil/:username/coleccion': <PublicCollectionScreen /> };

test('el perfil: nivel, desde cuándo, la temporada con su tramo, los récords, la colección y el planetario', async () => {
  mockApi({ 'GET /galaxy/api/profiles/vega': () => jsonResponse(200, profile()) });
  renderAt('/perfil/vega', screens);
  expect(await screen.findByRole('heading', { level: 1, name: 'vega' })).toBeInTheDocument();
  expect(screen.getByText(t.level(7))).toBeInTheDocument();
  expect(screen.getByText(t.since('2026-11-03T10:00:00.000Z'))).toBeInTheDocument();
  expect(t.since('2026-11-03T10:00:00.000Z')).toBe('Miembro desde noviembre de 2026');

  const season = screen.getByRole('region', { name: t.seasonTitle });
  expect(season).toHaveTextContent(t.tier.silver);
  expect(season).toHaveTextContent('2400');
  expect(season).toHaveTextContent('4');
  const records = screen.getByRole('region', { name: t.records });
  expect(records).toHaveTextContent('9');
  expect(records).toHaveTextContent('12');
  expect(records).toHaveTextContent('40');

  const collection = screen.getByRole('region', { name: t.collectionTitle });
  expect(collection).toHaveTextContent(copy.hub.galaxies(23));
  expect(within(collection).getByRole('link', { name: t.seeCollection })).toHaveAttribute('href', '/perfil/vega/coleccion');
  const planetarium = screen.getByRole('region', { name: copy.planetarium.title });
  expect(planetarium).toHaveTextContent(t.prestige(31));
  expect(within(planetarium).getByRole('article', { name: 'Kathra' })).toBeInTheDocument();
  expect(within(planetarium).getByRole('link', { name: t.visitPlanetarium })).toHaveAttribute('href', '/planetario/vega');
});

test('sin puntos esta temporada lo dice, y un nombre sin jugador también', async () => {
  mockApi({ 'GET /galaxy/api/profiles/vega': () => jsonResponse(200, profile({ season: null, planetarium: { prestige: 0, exhibits: 0, cover: null } })) });
  const view = renderAt('/perfil/vega', screens);
  expect(await screen.findByText(t.noSeason)).toBeInTheDocument();
  expect(screen.getByText(t.noExhibits)).toBeInTheDocument();
  view.unmount();
  mockApi({ 'GET /galaxy/api/profiles/nadie': () => jsonResponse(404, { error: 'profile_not_found' }) });
  renderAt('/perfil/nadie', screens);
  expect(await screen.findByText('No hay ningún jugador con ese nombre')).toBeInTheDocument();
});

test('la colección pública: sus cartas sin acciones, por rareza y paginada', async () => {
  const page = (items: PublicGalaxy[], next?: string): PublicCollectionPage => ({ items, ...(next ? { next } : {}), counts: { common: 0, uncommon: 0, rare: 2, epic: 0, legendary: 1 } });
  const fetch = mockApi({
    'GET /galaxy/api/profiles/vega/galaxies?sort=rarity&limit=30': () => jsonResponse(200, page([pub(), pub({ id: 'g2', name: 'Orvel', tier: 'rare', finish: 'normal' })], 'c1')),
    'GET /galaxy/api/profiles/vega/galaxies?sort=rarity&limit=30&cursor=c1': () => jsonResponse(200, page([pub({ id: 'g3', name: 'Nimbus', tier: 'rare', finish: 'normal' })])),
    'GET /galaxy/api/profiles/vega/galaxies?sort=rarity&limit=30&tier=rare': () => jsonResponse(200, page([pub({ id: 'g2', name: 'Orvel', tier: 'rare', finish: 'normal' })])),
  });
  const user = userEvent.setup();
  renderAt('/perfil/vega/coleccion', screens);
  expect(await screen.findByRole('heading', { level: 1, name: t.collectionOf('vega') })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: copy.backTo.profile('vega') })).toHaveAttribute('href', '/perfil/vega');
  const grid = await screen.findByRole('list', { name: t.collectionOf('vega') });
  expect(within(grid).getAllByRole('article')).toHaveLength(2);
  expect(within(grid).queryAllByRole('button')).toHaveLength(0);
  expect(within(grid).queryAllByRole('link')).toHaveLength(0);

  await user.click(screen.getByRole('button', { name: copy.collection.loadMore }));
  expect(await within(grid).findByRole('article', { name: 'Nimbus' })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: new RegExp(copy.tiers.rare) }));
  await waitFor(() => expect(fetch.mock.calls.map(([url]) => url)).toContain('/galaxy/api/profiles/vega/galaxies?sort=rarity&limit=30&tier=rare'));
  await waitFor(() => expect(within(screen.getByRole('list', { name: t.collectionOf('vega') })).getAllByRole('article')).toHaveLength(1));
});

// The banner (Nov plan C2/C4): one of their galaxies, dark and blurred at the top of the profile; its special finish
// themes the whole page (subtly, behind the panels). None without a banner; none for a normal finish.
test('con banner de acabado especial, el perfil lleva el banner y el tema de su acabado', async () => {
  mockApi({ 'GET /galaxy/api/profiles/vega': () => jsonResponse(200, profile({ banner: pub({ finish: 'rift' }) })) });
  const { container } = renderAt('/perfil/vega', screens);
  await screen.findByRole('heading', { level: 1, name: 'vega' });
  expect(container.querySelector('.profile-banner')).not.toBeNull();
  expect(container.querySelector('.profile-root')).toHaveAttribute('data-finish', 'rift');
});

test('sin banner no hay banner ni tema; con acabado normal, banner sin tema', async () => {
  mockApi({ 'GET /galaxy/api/profiles/vega': () => jsonResponse(200, profile()), 'GET /galaxy/api/profiles/lyra': () => jsonResponse(200, profile({ username: 'lyra', banner: pub({ finish: 'normal' }) })) });
  const first = renderAt('/perfil/vega', screens);
  await screen.findByRole('heading', { level: 1, name: 'vega' });
  expect(first.container.querySelector('.profile-banner')).toBeNull();
  expect(first.container.querySelector('.profile-root')).not.toHaveAttribute('data-finish');
  first.unmount();
  const second = renderAt('/perfil/lyra', screens);
  await screen.findByRole('heading', { level: 1, name: 'lyra' });
  expect(second.container.querySelector('.profile-banner')).not.toBeNull();
  expect(second.container.querySelector('.profile-root')).not.toHaveAttribute('data-finish');
});

test('la cabecera: el avatar grande y la barra de experiencia hasta el siguiente nivel', async () => {
  mockApi({ 'GET /galaxy/api/profiles/vega': () => jsonResponse(200, profile({ xp: { into: 1240, next: 2000 } })) });
  const { container } = renderAt('/perfil/vega', screens);
  const bar = await screen.findByRole('progressbar', { name: t.xpBar(8) });
  expect(bar).toHaveAttribute('aria-valuenow', '1240');
  expect(bar).toHaveAttribute('aria-valuemax', '2000');
  expect(screen.getByText(t.xpLeft(760, 8))).toBeInTheDocument();
  expect(container.querySelector<HTMLElement>('.profile-avatar .avatar-box')!.style.getPropertyValue('--s')).toBe('3');
});

test('en el nivel más alto no hay barra: lo dice', async () => {
  mockApi({ 'GET /galaxy/api/profiles/vega': () => jsonResponse(200, profile({ xp: { into: 500, next: null } })) });
  renderAt('/perfil/vega', screens);
  expect(await screen.findByText(t.maxLevel)).toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});
