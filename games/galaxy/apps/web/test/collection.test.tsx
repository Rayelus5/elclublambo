import type { CollectionPage, GachaView, GalaxyDetail, GalaxySummary, Tier } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { CollectionScreen } from '../src/collection/CollectionScreen';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// The collection (GDD §8.5): a paged grid with filters and order, the detail with front, back and lineage, and the two
// ways to spend galaxies — disintegrate into dust (confirmed) and fuse five of a tier into the next (cost shown first).
vi.mock('../src/galaxy/client', () => ({ requestGalaxy: vi.fn(() => new Promise(() => {})) }));
vi.mock('../src/galaxy/compose', () => ({ composeInto: vi.fn(() => 'webgl') }));
afterEach(() => vi.unstubAllGlobals());

const g = (id: string, tier: Tier = 'common', name = `Gal ${id}`): GalaxySummary => ({
  id,
  seed: String(5000 + id.length * 7 + id.charCodeAt(id.length - 1)),
  tier,
  finish: 'normal',
  traits: { galaxy_type: 'spiral', palette: 'andromeda_blue', phenomenon: 'none' },
  name,
  designation: `GX-${id.toUpperCase().padStart(6, '0')}`,
  featured: false,
  level: 1,
  createdAt: '2026-11-06T20:00:00Z',
});
const page = (items: GalaxySummary[], next?: string): CollectionPage => ({
  items,
  ...(next ? { next } : {}),
  counts: { common: 6, uncommon: 0, rare: 1, epic: 0, legendary: 1 },
  fusion: { count: 5, dust: [20, 50, 120, 300] },
});
const gacha: GachaView = { banners: [], costs: { coins: 100, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 0, dust: 40, signal: 0 } };
const detail = (over: Partial<GalaxyDetail> = {}): GalaxyDetail => ({
  ...g('g9', 'epic', 'Kathra'),
  origin: 'fusion',
  lineage: [
    { id: 'p1', name: 'Selem', designation: 'GX-0000P1', tier: 'rare' },
    { id: 'p2', name: 'Orty', designation: 'GX-0000P2', tier: 'rare' },
  ],
  dna: 'ab'.repeat(32),
  dust: 113,
  ...over,
});

const screens = { '/coleccion': <CollectionScreen />, '/coleccion/:id': <CollectionScreen /> };
const calls = (fetch: ReturnType<typeof mockApi>) => fetch.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`);

test('la rejilla muestra tus galaxias y carga la página siguiente con el cursor', async () => {
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    'GET /galaxy/api/galaxies?sort=new&limit=30': () => jsonResponse(200, page([g('a'), g('b')], 'c1')),
    'GET /galaxy/api/galaxies?sort=new&limit=30&cursor=c1': () => jsonResponse(200, page([g('c')])),
  });
  renderAt('/coleccion', screens);
  expect(await screen.findByRole('article', { name: 'Gal a' })).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: copy.collection.loadMore }));
  expect(await screen.findByRole('article', { name: 'Gal c' })).toBeInTheDocument();
  expect(screen.getAllByRole('article')).toHaveLength(3);
  expect(screen.queryByRole('button', { name: copy.collection.loadMore })).not.toBeInTheDocument();
});

test('los filtros y el orden cambian la consulta', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    'GET /galaxy/api/galaxies?sort=new&limit=30': () => jsonResponse(200, page([g('a')])),
    'GET /galaxy/api/galaxies?tier=rare&sort=new&limit=30': () => jsonResponse(200, page([g('r', 'rare')])),
    'GET /galaxy/api/galaxies?tier=rare&sort=rarity&limit=30': () => jsonResponse(200, page([g('r', 'rare')])),
    'GET /galaxy/api/galaxies?tier=rare&type=ring&sort=rarity&limit=30': () => jsonResponse(200, page([])),
  });
  const user = userEvent.setup();
  renderAt('/coleccion', screens);
  await screen.findByRole('article', { name: 'Gal a' });
  await user.click(screen.getByRole('button', { name: new RegExp(copy.tiers.rare) }));
  expect(await screen.findByRole('article', { name: 'Gal r' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: copy.collection.sortRarity }));
  await user.selectOptions(screen.getByLabelText(copy.traitNames['galaxy_type']!), copy.traitValues.galaxy_type.ring);
  expect(await screen.findByText(copy.collection.emptyFiltered)).toBeInTheDocument();
  expect(calls(fetch)).toContain('GET /galaxy/api/galaxies?tier=rare&type=ring&sort=rarity&limit=30');
});

test('el detalle muestra anverso, reverso, el polvo que daría y el linaje', async () => {
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    'GET /galaxy/api/galaxies?sort=new&limit=30': () => jsonResponse(200, page([g('g9', 'epic', 'Kathra')])),
    'GET /galaxy/api/galaxies/g9': () => jsonResponse(200, detail()),
  });
  renderAt('/coleccion/g9', screens);
  const dialog = await screen.findByRole('dialog', { name: 'Kathra' });
  expect(within(dialog).getByRole('article', { name: 'Kathra' })).toBeInTheDocument();
  expect(within(dialog).getByRole('article', { name: copy.card.back('Kathra') })).toBeInTheDocument();
  const lineage = within(dialog).getByRole('list', { name: copy.collection.lineage });
  expect(lineage).toHaveTextContent('Selem');
  expect(lineage).toHaveTextContent('Orty');
  expect(dialog).toHaveTextContent(copy.collection.origin.fusion);
});

test('desintegrar pide confirmación con el polvo que da y actualiza el saldo', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    'GET /galaxy/api/galaxies?sort=new&limit=30': () => jsonResponse(200, page([g('g9', 'epic', 'Kathra')])),
    'GET /galaxy/api/galaxies/g9': () => jsonResponse(200, detail()),
    'POST /galaxy/api/galaxies/g9/disintegrate': () => jsonResponse(200, { dust: 113, wallet: { coins: 0, dust: 153, signal: 0 } }),
  });
  const user = userEvent.setup();
  renderAt('/coleccion/g9', screens);
  await screen.findByLabelText(copy.hub.resource.dust(40));
  const dialog = await screen.findByRole('dialog', { name: 'Kathra' });
  await user.click(within(dialog).getByRole('button', { name: copy.collection.disintegrate }));
  const confirm = await screen.findByRole('alertdialog', { name: copy.collection.disintegrateTitle('Kathra') });
  expect(confirm).toHaveTextContent(copy.collection.disintegrateBody(113));
  expect(calls(fetch)).not.toContain('POST /galaxy/api/galaxies/g9/disintegrate');
  await user.click(within(confirm).getByRole('button', { name: copy.collection.disintegrate }));
  expect(await screen.findByLabelText(copy.hub.resource.dust(153))).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(copy.collection.disintegrated('Kathra', 113)));
  // Navigation back to the grid is a transition: the detail closes on the next render.
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Kathra' })).not.toBeInTheDocument());
  const post = fetch.mock.calls.find(([url]) => url === '/galaxy/api/galaxies/g9/disintegrate')!;
  expect((post[1]?.headers as Record<string, string>)['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
});

const fusePage = () => page([...['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((id) => g(id)), g('r1', 'rare'), g('l1', 'legendary')]);

test('fusionar exige cinco del mismo nivel, enseña el coste y revela la nueva', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    'GET /galaxy/api/galaxies?sort=new&limit=30': () => jsonResponse(200, fusePage()),
    'POST /galaxy/api/galaxies/fuse': () => jsonResponse(200, { galaxy: g('n1', 'uncommon', 'Zenveae'), wallet: { coins: 0, dust: 20, signal: 0 } }),
  });
  const user = userEvent.setup();
  renderAt('/coleccion', screens);
  await screen.findByRole('article', { name: 'Gal c1' });
  await user.click(screen.getByRole('button', { name: copy.collection.fuse }));
  for (const id of ['c1', 'c2', 'c3', 'c4']) await user.click(screen.getByRole('button', { name: copy.collection.select(`Gal ${id}`) }));
  const bar = screen.getByRole('region', { name: copy.collection.fuse });
  expect(bar).toHaveTextContent(copy.collection.fuseProgress(4, 5));
  expect(within(bar).getByRole('button', { name: copy.collection.fuseConfirm })).toBeDisabled();
  // Another tier and legendaries cannot join this fusion.
  expect(screen.getByRole('button', { name: copy.collection.select('Gal r1') })).toBeDisabled();
  expect(screen.getByRole('button', { name: copy.collection.select('Gal l1') })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: copy.collection.select('Gal c5') }));
  expect(bar).toHaveTextContent(copy.collection.fuseCost(20));
  await user.click(within(bar).getByRole('button', { name: copy.collection.fuseConfirm }));
  const reveal = await screen.findByRole('dialog', { name: copy.collection.revealTitle });
  expect(within(reveal).getByRole('article', { name: 'Zenveae' })).toBeInTheDocument();
  const post = fetch.mock.calls.find(([url]) => url === '/galaxy/api/galaxies/fuse')!;
  expect(JSON.parse(String(post[1]?.body))).toEqual({ ids: ['c1', 'c2', 'c3', 'c4', 'c5'] });
  expect(screen.getByLabelText(copy.hub.resource.dust(20))).toBeInTheDocument();
});

test('sin polvo suficiente la fusión se ve bloqueada antes de pedirla', async () => {
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, { ...gacha, wallet: { coins: 0, dust: 5, signal: 0 } }),
    'GET /galaxy/api/galaxies?sort=new&limit=30': () => jsonResponse(200, fusePage()),
  });
  const user = userEvent.setup();
  renderAt('/coleccion', screens);
  await screen.findByLabelText(copy.hub.resource.dust(5));
  await user.click(screen.getByRole('button', { name: copy.collection.fuse }));
  for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) await user.click(screen.getByRole('button', { name: copy.collection.select(`Gal ${id}`) }));
  const bar = screen.getByRole('region', { name: copy.collection.fuse });
  expect(bar).toHaveTextContent(copy.collection.notEnoughDust);
  expect(within(bar).getByRole('button', { name: copy.collection.fuseConfirm })).toBeDisabled();
});

test('los errores del servidor se muestran con su texto', async () => {
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    'GET /galaxy/api/galaxies?sort=new&limit=30': () => jsonResponse(200, fusePage()),
    'POST /galaxy/api/galaxies/fuse': () => jsonResponse(409, { error: 'invalid_fusion' }),
  });
  const user = userEvent.setup();
  renderAt('/coleccion', screens);
  await screen.findByLabelText(copy.hub.resource.dust(40));
  await user.click(screen.getByRole('button', { name: copy.collection.fuse }));
  for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) await user.click(screen.getByRole('button', { name: copy.collection.select(`Gal ${id}`) }));
  await user.click(within(screen.getByRole('region', { name: copy.collection.fuse })).getByRole('button', { name: copy.collection.fuseConfirm }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(copy.errors.invalid_fusion));
});
