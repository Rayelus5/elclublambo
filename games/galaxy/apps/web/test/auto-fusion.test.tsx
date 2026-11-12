import type { AutoFusionPreview, AutoFusionResult, CollectionPage, GachaView, GalaxyDetail, GalaxySummary, Tier } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { CollectionScreen } from '../src/collection/CollectionScreen';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';
import { pickOption } from './pick';

// Multiplayer plan, phase 2: the lock on a galaxy (detail and grid) and the automatic fusion's dialog (its starting
// point from the filters, the preview, the confirmation and what it made).
vi.mock('../src/galaxy/client', () => ({ requestGalaxy: vi.fn(() => new Promise(() => {})) }));
vi.mock('../src/galaxy/compose', () => ({ composeInto: vi.fn(() => 'webgl') }));
afterEach(() => vi.unstubAllGlobals());

const t = copy.collection.auto;
const g = (id: string, tier: Tier = 'common', over: Partial<GalaxySummary> = {}): GalaxySummary => ({
  id,
  seed: String(7000 + id.charCodeAt(id.length - 1)),
  tier,
  finish: 'normal',
  traits: { galaxy_type: 'spiral', palette: 'andromeda_blue', phenomenon: 'none' },
  name: `Gal ${id}`,
  designation: `GX-${id.toUpperCase().padStart(6, '0')}`,
  featured: false,
  level: 1,
  createdAt: '2026-11-06T20:00:00Z',
  ...over,
});
const page = (items: GalaxySummary[]): CollectionPage => ({ items, counts: { common: 25, uncommon: 0, rare: 0, epic: 0, legendary: 0 }, fusion: { count: 5, dust: [20, 50, 120, 300] } });
const gacha: GachaView = { banners: [], costs: { coins: 100, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 0, dust: 400, signal: 0 } };
const detail = (over: Partial<GalaxyDetail> = {}): GalaxyDetail => ({ ...g('g9', 'rare'), origin: 'pull', lineage: [], dna: 'ab'.repeat(32), dust: 30, levelUp: { dust: 20 }, refund: 0, ...over });
const screens = { '/coleccion': <CollectionScreen />, '/coleccion/:id': <CollectionScreen /> };

const preview: AutoFusionPreview = {
  steps: [
    { from: 'common', to: 'uncommon', fusions: 5, dust: 100 },
    { from: 'uncommon', to: 'rare', fusions: 1, dust: 50 },
  ],
  fusions: 6,
  dust: 150,
  wallet: 400,
  short: false,
  limited: false,
  kept: { busy: 0, locked: 2, finishes: 1, leveled: 0 },
};

test('poner y quitar el candado desde el detalle; con candado no se desintegra y dice por qué', async () => {
  let locked = false;
  const fetch = mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    'GET /galaxy/api/galaxies?sort=new&limit=30': () => jsonResponse(200, page([g('g9', 'rare')])),
    'GET /galaxy/api/galaxies/g9': () => jsonResponse(200, detail(locked ? { locked: true } : {})),
    'PUT /galaxy/api/galaxies/g9/lock': (body) => {
      locked = (body as { locked: boolean }).locked;
      return jsonResponse(200, detail(locked ? { locked: true } : {}));
    },
  });
  const user = userEvent.setup();
  renderAt('/coleccion/g9', screens);
  const dialog = await screen.findByRole('dialog', { name: 'Gal g9' });
  await user.click(within(dialog).getByRole('button', { name: copy.collection.lock }));
  expect(await within(dialog).findByRole('button', { name: copy.collection.unlock })).toHaveAttribute('aria-pressed', 'true');
  expect(within(dialog).getByRole('button', { name: copy.collection.disintegrate })).toBeDisabled();
  expect(dialog).toHaveTextContent(copy.collection.lockedReason);
  expect(fetch.mock.calls.some(([url, init]) => url === '/galaxy/api/galaxies/g9/lock' && init?.body === JSON.stringify({ locked: true }))).toBe(true);
});

test('en la rejilla una galaxia con candado lleva su candado y no se puede elegir para fusionar', async () => {
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    'GET /galaxy/api/galaxies?sort=new&limit=30': () => jsonResponse(200, page([g('c1', 'common', { locked: true }), g('c2')])),
  });
  const user = userEvent.setup();
  renderAt('/coleccion', screens);
  const card = await screen.findByRole('article', { name: 'Gal c1' });
  expect(within(card).getByRole('img', { name: copy.collection.lockedBadge })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: copy.collection.fuse }));
  expect(screen.getByRole('button', { name: copy.collection.select('Gal c1') })).toBeDisabled();
  expect(screen.getByRole('button', { name: copy.collection.select('Gal c2') })).toBeEnabled();
});

test('la fusión automática parte del filtro de rareza, enseña la previsión y fusiona al confirmar', async () => {
  const made: AutoFusionResult = { galaxies: [g('n1', 'rare'), g('n2', 'uncommon')], fusions: 6, dust: 150, more: false, wallet: { coins: 0, dust: 250, signal: 0 } };
  const bodies: unknown[] = [];
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    'GET /galaxy/api/galaxies?sort=new&limit=30': () => jsonResponse(200, page([g('c1'), g('c2')])),
    'GET /galaxy/api/galaxies?tier=common&sort=new&limit=30': () => jsonResponse(200, page([g('c1'), g('c2')])),
    'POST /galaxy/api/galaxies/fuse-auto': (body) => {
      bodies.push(body);
      return (body as { preview: boolean }).preview ? jsonResponse(200, preview) : jsonResponse(200, made);
    },
  });
  const user = userEvent.setup();
  renderAt('/coleccion', screens);
  await screen.findByRole('article', { name: 'Gal c1' });
  await user.click(screen.getByRole('button', { name: new RegExp(`^${copy.tiers.common}`) }));
  await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`^${copy.tiers.common}`) })).toHaveAttribute('aria-pressed', 'true'));
  await user.click(screen.getByRole('button', { name: t.open }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  expect(within(dialog).getByRole('combobox', { name: t.from })).toHaveTextContent(new RegExp(`^${copy.tiers.common}$`));
  expect(within(dialog).getByRole('combobox', { name: t.upTo })).toHaveTextContent(new RegExp(`^${copy.tiers.uncommon}$`));
  expect(await within(dialog).findByText(t.total(6, 150, 250))).toBeInTheDocument();
  expect(dialog).toHaveTextContent(t.kept([t.keptWhy.locked(2), t.keptWhy.finishes(1)]));
  expect(dialog).toHaveTextContent(t.upperBound);
  await user.click(within(dialog).getByRole('button', { name: t.confirm(6) }));
  const done = await screen.findByRole('dialog', { name: t.doneTitle });
  expect(within(done).getByRole('list', { name: t.madeLabel })).toHaveTextContent('Gal n1');
  const fused = (bodies as { preview: boolean; criteria: Record<string, unknown> }[]).filter((b) => !b.preview);
  expect(fused).toHaveLength(1);
  expect(fused[0]!.criteria).toMatchObject({ from: 'common', upTo: 'uncommon', keepFinishes: true, keepLeveled: true });
});

test('cambiar el «Desde» por encima del «Hasta» sube el «Hasta» y vuelve a pedir la previsión', async () => {
  const bodies: { criteria: Record<string, unknown> }[] = [];
  mockApi({
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    'GET /galaxy/api/galaxies?sort=new&limit=30': () => jsonResponse(200, page([g('c1')])),
    'POST /galaxy/api/galaxies/fuse-auto': (body) => {
      bodies.push(body as { criteria: Record<string, unknown> });
      return jsonResponse(200, { ...preview, steps: [], fusions: 0, dust: 0 });
    },
  });
  const user = userEvent.setup();
  renderAt('/coleccion', screens);
  await screen.findByRole('article', { name: 'Gal c1' });
  await user.click(screen.getByRole('button', { name: t.open }));
  const dialog = await screen.findByRole('dialog', { name: t.title });
  expect(await within(dialog).findByText(t.nothing)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: t.confirmNone })).toBeDisabled();
  await pickOption(user, within(dialog).getByRole('combobox', { name: t.from }), copy.tiers.rare);
  expect(within(dialog).getByRole('combobox', { name: t.upTo })).toHaveTextContent(new RegExp(`^${copy.tiers.epic}$`));
  // The dialog stays open: the list closed on its own.
  expect(screen.getByRole('dialog', { name: t.title })).toBeInTheDocument();
  await waitFor(() => expect(bodies.some((b) => b.criteria['from'] === 'rare' && b.criteria['upTo'] === 'epic')).toBe(true));
});
