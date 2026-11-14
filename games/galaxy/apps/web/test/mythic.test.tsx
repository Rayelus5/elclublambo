import type { CollectionPage, GachaView, GalaxySummary, MarketPage, MarketRules, MeResponse, MyMarket, Tier } from '@galaxy/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { FIELDS, itemName } from '../src/admin/forms/labels';
import { issueText } from '../src/admin/forms/issues';
import { GalaxyCard } from '../src/cards/GalaxyCard';
import { CollectionScreen } from '../src/collection/CollectionScreen';
import { copy } from '../src/copy/es';
import { MarketScreen } from '../src/market/MarketScreen';
import { ScannerScreen } from '../src/scanner/ScannerScreen';
import { jsonResponse, mockApi, renderAt } from './render';

// The «Mítica» (plan «rareza Mítica» M1) on the web: its name and look everywhere a rarity shows, a chip of its own
// in the collection, never picked for a fusion (nor offered as the automatic fusion's top), out of the market unless
// the admin allows it, its odds with two decimals, and the admin's fields for it.
vi.mock('../src/galaxy/client', () => ({ requestGalaxy: vi.fn(() => new Promise(() => {})) }));
vi.mock('../src/galaxy/compose', () => ({ composeInto: vi.fn(() => 'webgl') }));
afterEach(() => vi.unstubAllGlobals());

const g = (id: string, tier: Tier = 'common', over: Partial<GalaxySummary> = {}): GalaxySummary => ({
  id,
  seed: String(9000 + id.charCodeAt(id.length - 1)),
  tier,
  finish: tier === 'mythic' ? 'prismatic' : 'normal',
  traits: { galaxy_type: 'spiral', palette: 'andromeda_blue', phenomenon: 'pulsar' },
  name: `Gal ${id}`,
  designation: `GX-${id.toUpperCase().padStart(6, '0')}`,
  featured: false,
  level: 1,
  createdAt: '2026-11-13T08:00:00Z',
  ...over,
});
const counts = { common: 5, uncommon: 0, rare: 0, epic: 0, legendary: 1, mythic: 1 };
const page = (items: GalaxySummary[]): CollectionPage => ({ items, counts, fusion: { count: 5, dust: [20, 50, 120, 300] } });
const gacha = (over: Partial<GachaView['banners'][number]> = {}): GachaView => ({
  banners: [{ id: 'deep-scan', kind: 'standard', name: 'Escáner profundo', currency: 'signal', nextRates: [0.4998, 0.27986, 0.12993, 0.05997, 0.02999, 0.0005], sinceLegendary: 3, untilGuarantee: 7, welcome: false, ...over }],
  costs: { coins: 100, coinsTen: 900, signals: 1 },
  freePullAvailable: false,
  wallet: { coins: 0, dust: 400, signal: 0 },
});
const collection = { '/coleccion': <CollectionScreen />, '/coleccion/:id': <CollectionScreen /> };

test('la carta de una mítica dice Mítica y lleva su rareza', () => {
  render(<GalaxyCard galaxy={g('m1', 'mythic')} size={200} />);
  const card = screen.getByRole('article', { name: 'Gal m1' });
  expect(card).toHaveAttribute('data-tier', 'mythic');
  expect(card).toHaveTextContent(copy.tiers.mythic);
});

describe('la colección', () => {
  test('la mítica tiene su chip con su número, va primero y no se elige para fusionar', async () => {
    mockApi({
      'GET /galaxy/api/gacha': () => jsonResponse(200, gacha()),
      'GET /galaxy/api/galaxies?sort=rarity&limit=30': () => jsonResponse(200, page([g('m1', 'mythic'), g('l1', 'legendary'), ...['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => g(id))])),
    });
    const user = userEvent.setup();
    renderAt('/coleccion', collection);
    await screen.findByRole('article', { name: 'Gal m1' });
    const chips = screen.getByRole('group', { name: copy.collection.filters });
    const names = within(chips).getAllByRole('button').map((b) => b.textContent);
    expect(names[1]).toBe(`${copy.tiers.mythic}1`);
    await user.click(screen.getByRole('button', { name: copy.collection.fuse }));
    expect(screen.getByRole('button', { name: copy.collection.select('Gal m1') })).toBeDisabled();
    expect(screen.getByRole('button', { name: copy.collection.select('Gal l1') })).toBeDisabled();
    expect(screen.getByRole('button', { name: copy.collection.select('Gal c1') })).toBeEnabled();
    expect(screen.getByRole('region', { name: copy.collection.fuse })).toHaveTextContent(copy.collection.fuseHelp(5));
  });

  test('la fusión automática nunca ofrece la mítica como tope, ni parte de ella', async () => {
    mockApi({
      'GET /galaxy/api/gacha': () => jsonResponse(200, gacha()),
      'GET /galaxy/api/galaxies?sort=rarity&limit=30': () => jsonResponse(200, page([g('m1', 'mythic')])),
      'GET /galaxy/api/galaxies?tier=mythic&sort=new&limit=30': () => jsonResponse(200, page([g('m1', 'mythic')])),
      'POST /galaxy/api/galaxies/fuse-auto': () => jsonResponse(200, { steps: [], fusions: 0, dust: 0, wallet: 400, short: false, limited: false, kept: { busy: 0, locked: 0, finishes: 0, leveled: 0 } }),
    });
    const user = userEvent.setup();
    renderAt('/coleccion', collection);
    await screen.findByRole('article', { name: 'Gal m1' });
    await user.click(screen.getByRole('button', { name: new RegExp(`^${copy.tiers.mythic}`) }));
    await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`^${copy.tiers.mythic}`) })).toHaveAttribute('aria-pressed', 'true'));
    await user.click(screen.getByRole('button', { name: copy.collection.auto.open }));
    const dialog = await screen.findByRole('dialog', { name: copy.collection.auto.title });
    expect(within(dialog).getByRole('combobox', { name: copy.collection.auto.from })).toHaveTextContent(new RegExp(`^${copy.tiers.common}$`));
    await user.click(within(dialog).getByRole('combobox', { name: copy.collection.auto.upTo }));
    const options = within(document.getElementById(within(dialog).getByRole('combobox', { name: copy.collection.auto.upTo }).getAttribute('aria-controls')!)!).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([copy.tiers.uncommon, copy.tiers.rare, copy.tiers.epic, copy.tiers.legendary]);
  });
});

describe('el mercado', () => {
  const me: MeResponse = { id: 'a1', username: 'sonda_rayo', roles: [], mfa: false, level: 12 };
  const rules = (over: Partial<MarketRules> = {}): MarketRules => ({
    commission: 0.07,
    minPrice: { common: 50, uncommon: 120, rare: 400, epic: 1500, legendary: 6000, mythic: 15_000 },
    mythicListing: false,
    maxPrice: 10_000_000,
    canTrade: true,
    reason: null,
    minLevel: 10,
    minAccountDays: 3,
    listingsLeft: 10,
    purchasesLeft: 10,
    days: 7,
    offers: { enabled: true, hours: 48, openLeft: 10, todayLeft: 30 },
    ...over,
  });
  const mount = (r: Partial<MarketRules> = {}) =>
    mockApi({
      'GET /galaxy/api/auth/me': () => jsonResponse(200, me),
      'GET /galaxy/api/gacha': () => jsonResponse(200, gacha()),
      'GET /galaxy/api/market?sort=new': () => jsonResponse(200, { listings: [], next: null, rules: rules(r) } satisfies MarketPage),
      'GET /galaxy/api/market/mine': () => jsonResponse(200, { active: [], sold: [], rules: rules(r) } satisfies MyMarket),
      'GET /galaxy/api/galaxies?sort=rarity&limit=30': () => jsonResponse(200, page([g('m1', 'mythic', { name: 'Ónice' }), g('r1', 'rare', { name: 'Libre' })])),
      'GET /galaxy/api/galaxies/m1': () => jsonResponse(200, { ...g('m1', 'mythic', { name: 'Ónice' }), origin: 'pull', lineage: [], dna: 'ab'.repeat(32), dust: 750, levelUp: { dust: 20 }, refund: 0 }),
    });

  test('una mítica no se puede elegir para vender y dice por qué', async () => {
    mount();
    renderAt('/mercado?pestana=vender', { '/mercado': <MarketScreen /> });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: copy.market.choose }));
    const picker = await screen.findByRole('dialog', { name: copy.market.pickTitle });
    expect(within(picker).getByRole('button', { name: copy.market.pickOne('Ónice') })).toBeDisabled();
    expect(within(picker).getByText(copy.market.mythicLocked)).toBeInTheDocument();
    expect(within(picker).getByRole('button', { name: copy.market.pickOne('Libre') })).toBeEnabled();
  });

  test('llegando desde la colección con una mítica, el formulario dice por qué no y no deja ponerla en venta', async () => {
    mount();
    renderAt('/mercado?pestana=vender&galaxia=m1', { '/mercado': <MarketScreen /> });
    expect(await screen.findByText(copy.market.mythicNotListable)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.market.list })).toBeDisabled();
  });

  test('si el mercado lo permite, una mítica se vende desde su mínimo', async () => {
    mount({ mythicListing: true });
    renderAt('/mercado?pestana=vender&galaxia=m1', { '/mercado': <MarketScreen /> });
    expect(await screen.findByRole('textbox', { name: copy.market.priceLabel })).toHaveValue('15000');
    expect(screen.queryByText(copy.market.mythicNotListable)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.market.list })).toBeEnabled();
  });
});

describe('el escáner', () => {
  test('la mítica sale en las probabilidades con dos decimales', async () => {
    mockApi({ 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha()) });
    renderAt('/escaner', { '/escaner': <ScannerScreen /> });
    const odds = await screen.findByRole('table', { name: copy.scanner.odds });
    const rows = within(odds).getAllByRole('row');
    expect(rows).toHaveLength(6);
    expect(rows[0]).toHaveAttribute('data-tier', 'mythic');
    expect(rows[0]).toHaveTextContent(copy.tiers.mythic);
    expect(copy.scanner.rate(0.0005)).toMatch(/^0,05\s%$/);
    expect(rows[0]).toHaveTextContent(/0,05\s%/);
    expect(rows[1]).toHaveTextContent(/Legendaria\s*3\s%/);
  });

  test('mientras su probabilidad es 0, la mítica no sale en la tabla', async () => {
    mockApi({ 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha({ nextRates: [0.5, 0.28, 0.13, 0.06, 0.03, 0] })) });
    renderAt('/escaner', { '/escaner': <ScannerScreen /> });
    const odds = await screen.findByRole('table', { name: copy.scanner.odds });
    expect(within(odds).getAllByRole('row')).toHaveLength(5);
    expect(odds).not.toHaveTextContent(copy.tiers.mythic);
  });
});

describe('el panel de administración', () => {
  test('la probabilidad de mítica, el permiso de venderla y su fila en cada lista por rareza', () => {
    expect(FIELDS.gacha?.['mythic']).toMatchObject({ unit: 'percent' });
    expect(FIELDS.market?.['mythicListing']?.label).toBeTruthy();
    expect(FIELDS.market?.['minPrice.mythic']?.label).toBe(copy.tiers.mythic);
    expect(itemName(FIELDS.galaxies!['disintegrate.tier']!, 5)).toBe(copy.tiers.mythic);
    expect(itemName(FIELDS.planetarium!['points.tiers']!, 5)).toBe(copy.tiers.mythic);
    // Fusion recipes stop at the epic: no mythic there.
    expect(itemName(FIELDS.galaxies!['fusion.dust']!, 4)).toBeNull();
    expect(issueText('minPrice grows with the tier')).toMatch(/rareza/);
  });
});
