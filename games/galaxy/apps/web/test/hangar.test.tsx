import type { CollectionPage, FinishRunRequest, GalaxySummary, HangarView, RunResult } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { clearPending, loadPending, savePending } from '../src/api/pending-run';
import type { RunEnd } from '../src/arena/ArenaScreen';
import { copy } from '../src/copy/es';
import { HangarScreen } from '../src/hangar/HangarScreen';
import { jsonResponse, mockApi, renderAt } from './render';

// The hangar (GDD §5.1, §8.4, §11.3 bis): sector, probe, relic slots and the daily yield before launching; and a run
// whose result never reached the server is sent again with the same key (Review Focus 2).

// The arena is replaced by a stub that keeps its props (to end a run by hand) and can fail like a chunk that did not load.
const arena = vi.hoisted(() => ({ props: null as null | { onEnd: (e: RunEnd) => void; onSave?: (e: RunEnd) => void }, fail: false }));
vi.mock('../src/arena/ArenaScreen', () => {
  const Stub = (p: { onEnd: (e: RunEnd) => void; onSave?: (e: RunEnd) => void }) => {
    if (arena.fail) throw new Error('Failed to fetch dynamically imported module');
    arena.props = p;
    return <div data-testid="arena" />;
  };
  return { ArenaScreen: Stub, default: Stub };
});

const galaxy = (over: Partial<GalaxySummary> = {}): GalaxySummary => ({
  id: 'g1',
  seed: '12345',
  tier: 'legendary',
  finish: 'holo',
  traits: { galaxy_type: 'spiral', arms: '3', palette: 'solar_gold', phenomenon: 'pulsar', size: 'large', core: 'bright', star_density: 'normal', background: 'deep_void' },
  name: 'Kathra',
  designation: 'GX-ABCDEF',
  featured: false,
  level: 1,
  createdAt: '2026-11-06T20:00:00Z',
  ...over,
});

const view = (over: Partial<HangarView> = {}): HangarView => ({
  sectors: [
    {
      id: 'outer-nebula',
      name: 'Nebulosa Exterior',
      description: DEFAULT_CONTENT.sectors[0]!.description,
      boss: { name: 'La Colmena Rota', title: 'Núcleo de la Estática', sprite: 'hive' },
      fauna: [
        { id: 'mite', name: 'Ácaro de estática', sprite: 'mite' },
        { id: 'ray', name: 'Manta de vacío', sprite: 'ray' },
      ],
      layerSeconds: 300,
    },
  ],
  probes: [{ id: 'lumen', name: 'Lumen', description: 'Sonda de reconocimiento', sprite: 'probe-lumen', hp: 100, speed: 90, weapon: { id: 'pulse', name: 'Pulso láser', icon: 'icon-pulse' }, unlocked: true, condition: null, progress: 1 }],
  probe: 'lumen',
  test: { taken: true, probe: 'lumen' },
  slots: 2,
  maxSlots: 6,
  loadout: [null, null],
  daily: { playedSeconds: 0, fullSecondsLeft: 3 * 3600, multiplier: 1, resetsAt: '2026-11-07T23:00:00.000Z' },
  runsEnabled: true,
  ...over,
});

const result: RunResult = {
  id: 'r1',
  outcome: 'extracted',
  ticks: 6 * 3600,
  depth: 1,
  kills: 640,
  level: 15,
  payout: { coins: 40, dust: 12, signals: 1 },
  breakdown: { layers: [{ layer: 1, coins: 40, dust: 12, multiplier: 1 }], share: 1, daily: [{ seconds: 360, multiplier: 1 }] },
  wallet: { coins: 140, dust: 12, signal: 11 },
};

const body: FinishRunRequest = { outcome: 'extracted', ticks: 21600, depth: 1, kills: 640, bossKills: 1, level: 15, loot: [{ coins: 40, dust: 12 }], hash: '0123456789abcdef', inputs: 'AQEA' };

beforeEach(() => {
  localStorage.clear();
  arena.props = null;
  arena.fail = false;
});

test('el Hangar muestra el sector, la sonda, 2 ranuras abiertas y 4 cerradas, y el premio del día', async () => {
  mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view()) });
  renderAt('/incursion', { '/incursion': <HangarScreen /> });
  expect(await screen.findByRole('heading', { name: 'Nebulosa Exterior' })).toBeInTheDocument();
  expect(screen.getByText('La Colmena Rota')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Lumen' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: copy.hangar.chooseRelic })).toHaveLength(2);
  expect(screen.getAllByText(copy.hangar.lockedSlot)).toHaveLength(4);
  expect(screen.getByText(copy.hangar.dailyFull('3 h 0 min'))).toBeInTheDocument();
  expect(screen.getByRole('button', { name: copy.hangar.launch })).toBeEnabled();
});

test('elegir una reliquia la equipa y dice qué hará; también se puede quitar', async () => {
  const page: CollectionPage = { items: [galaxy(), galaxy({ id: 'g2', name: 'Orvel', tier: 'common', equipped: false })], counts: { common: 1, uncommon: 0, rare: 0, epic: 0, legendary: 1 }, fusion: { count: 5, dust: [20, 50, 120, 300] } };
  const fetch = mockApi({
    'GET /galaxy/api/hangar': () => jsonResponse(200, view()),
    'GET /galaxy/api/galaxies?sort=rarity&limit=30': () => jsonResponse(200, page),
    'PUT /galaxy/api/hangar/loadout': (b) => {
      const relics = (b as { relics: (string | null)[] }).relics;
      return jsonResponse(200, view({ loadout: relics.map((id) => (id === 'g1' ? { ...galaxy(), equipped: true } : null)) }));
    },
  });
  renderAt('/incursion', { '/incursion': <HangarScreen /> });
  fireEvent.click((await screen.findAllByRole('button', { name: copy.hangar.chooseRelic }))[0]!);
  const picker = await screen.findByRole('dialog', { name: copy.hangar.pickerTitle });
  fireEvent.click(await within(picker).findByRole('button', { name: copy.hangar.equip('Kathra') }));
  const slot = await screen.findByRole('group', { name: copy.hangar.slot(1) });
  expect(slot).toHaveTextContent('Kathra');
  expect(slot).toHaveTextContent(copy.hangar.families.blades);
  expect(slot).toHaveTextContent(copy.hangar.elements.burn);
  expect(slot).toHaveTextContent(copy.hangar.phenomena.pulsar);
  const put = fetch.mock.calls.find(([url, init]) => url === '/galaxy/api/hangar/loadout' && init?.method === 'PUT')!;
  expect(JSON.parse(String(put[1]!.body))).toEqual({ relics: ['g1', null] });
  fireEvent.click(within(slot).getByRole('button', { name: copy.hangar.unequip('Kathra') }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: copy.hangar.chooseRelic })).toHaveLength(2));
});

test('lanzar pide la partida y abre la arena', async () => {
  mockApi({
    'GET /galaxy/api/hangar': () => jsonResponse(200, view()),
    'POST /galaxy/api/runs': () => jsonResponse(200, { id: 'r1', seed: '1', sector: 'outer-nebula', probe: 'lumen', relics: [], content: DEFAULT_CONTENT, contentVersion: 0, startedAt: '2026-11-07T10:00:00Z' }),
  });
  renderAt('/incursion', { '/incursion': <HangarScreen /> });
  fireEvent.click(await screen.findByRole('button', { name: copy.hangar.launch }));
  expect(await screen.findByTestId('arena')).toBeInTheDocument();
});

test('una partida pendiente se reenvía al entrar con la misma clave y se borra al recibir el resultado', async () => {
  savePending({ runId: 'r1', key: 'k-12345678', body });
  const fetch = mockApi({
    'GET /galaxy/api/hangar': () => jsonResponse(200, view()),
    'POST /galaxy/api/runs/r1/finish': () => jsonResponse(200, result),
  });
  renderAt('/incursion', { '/incursion': <HangarScreen /> });
  expect(await screen.findByRole('heading', { name: copy.results.extracted })).toBeInTheDocument();
  const sent = fetch.mock.calls.find(([url]) => url === '/galaxy/api/runs/r1/finish')!;
  expect((sent[1]!.headers as Record<string, string>)['idempotency-key']).toBe('k-12345678');
  expect(JSON.parse(String(sent[1]!.body))).toEqual(body);
  expect(loadPending()).toBeNull();
});

test('si el final no llega (error del servidor), se conserva y se ofrece Reintentar con la misma clave', async () => {
  savePending({ runId: 'r1', key: 'k-12345678', body });
  let fail = true;
  const fetch = mockApi({
    'GET /galaxy/api/hangar': () => jsonResponse(200, view()),
    'POST /galaxy/api/runs/r1/finish': () => (fail ? jsonResponse(500, { error: 'internal' }) : jsonResponse(200, result)),
  });
  renderAt('/incursion', { '/incursion': <HangarScreen /> });
  const retry = await screen.findByRole('button', { name: copy.results.retry });
  expect(loadPending()).toMatchObject({ runId: 'r1', key: 'k-12345678' });
  fail = false;
  fireEvent.click(retry);
  expect(await screen.findByRole('heading', { name: copy.results.extracted })).toBeInTheDocument();
  const keys = fetch.mock.calls.filter(([url]) => url === '/galaxy/api/runs/r1/finish').map(([, init]) => (init!.headers as Record<string, string>)['idempotency-key']);
  expect(keys).toEqual(['k-12345678', 'k-12345678']);
  clearPending();
});

test('con las incursiones cerradas no se puede lanzar y se dice por qué', async () => {
  mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view({ runsEnabled: false })) });
  renderAt('/incursion', { '/incursion': <HangarScreen /> });
  expect(await screen.findByRole('button', { name: copy.hangar.launch })).toBeDisabled();
  expect(screen.getByText(copy.errors.runs_disabled)).toBeInTheDocument();
});

const started = { id: 'r1', seed: '1', sector: 'outer-nebula', probe: 'lumen', relics: [], content: DEFAULT_CONTENT, contentVersion: 0, startedAt: '2026-11-07T10:00:00Z' };
const end: RunEnd = {
  outcome: 'died',
  summary: { ticks: 21600, outcome: 'dead', depth: 1, kills: 640, bossKills: 0, level: 15, loot: [{ coins: 40.6, dust: 12.2 }], hash: '0123456789abcdef' },
  inputs: 'AQEA',
};

test('el resultado se guarda en cuanto acaba la partida y luego se envía con esa misma clave', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/hangar': () => jsonResponse(200, view()),
    'POST /galaxy/api/runs': () => jsonResponse(200, started),
    'POST /galaxy/api/runs/r1/finish': () => jsonResponse(200, { ...result, outcome: 'died' }),
  });
  renderAt('/incursion', { '/incursion': <HangarScreen /> });
  fireEvent.click(await screen.findByRole('button', { name: copy.hangar.launch }));
  await screen.findByTestId('arena');
  act(() => arena.props!.onSave!(end));
  const kept = loadPending();
  expect(kept).toMatchObject({ runId: 'r1', body: { outcome: 'died', loot: [{ coins: 40, dust: 12 }] } });
  act(() => arena.props!.onEnd(end));
  expect(await screen.findByRole('heading', { name: copy.results.died })).toBeInTheDocument();
  const keys = fetch.mock.calls.filter(([url]) => url === '/galaxy/api/runs/r1/finish').map(([, init]) => (init!.headers as Record<string, string>)['idempotency-key']);
  expect(keys).toEqual([kept!.key]);
});

test.each([
  [401, 'unauthorized'],
  [403, 'forbidden'],
  [429, 'rate_limited'],
])('un %i al enviar el final no lo borra: se conserva y se ofrece Reintentar', async (status, error) => {
  savePending({ runId: 'r1', key: 'k-12345678', body });
  mockApi({
    'GET /galaxy/api/hangar': () => jsonResponse(200, view()),
    'POST /galaxy/api/runs/r1/finish': () => jsonResponse(status, { error }),
  });
  renderAt('/incursion', { '/incursion': <HangarScreen /> });
  expect(await screen.findByRole('button', { name: copy.results.retry })).toBeInTheDocument();
  expect(loadPending()).toMatchObject({ runId: 'r1', key: 'k-12345678' });
  clearPending();
});

test('si la arena no carga, se dice y se ofrece recargar en vez de dejar la pantalla en blanco', async () => {
  arena.fail = true;
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    mockApi({
      'GET /galaxy/api/hangar': () => jsonResponse(200, view()),
      'POST /galaxy/api/runs': () => jsonResponse(200, started),
    });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    fireEvent.click(await screen.findByRole('button', { name: copy.hangar.launch }));
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.hangar.arenaFailed);
    expect(screen.getByRole('button', { name: copy.hangar.reload })).toBeInTheDocument();
  } finally {
    quiet.mockRestore();
  }
});

describe('conjuntos de reliquias', () => {
  const traits = (over: Record<string, string>) => ({ galaxy_type: 'dwarf', arms: '0', size: 'medium', inclination: 'face_on', core: 'faint', star_density: 'normal', palette: 'monochrome', background: 'deep_void', phenomenon: 'none', ...over });
  const show = (a: Record<string, string>, b?: Record<string, string>) => {
    mockApi({
      'GET /galaxy/api/hangar': () =>
        jsonResponse(200, view({ loadout: [galaxy({ id: 'a', name: 'Kathra', traits: traits(a) }), b ? galaxy({ id: 'b', name: 'Orvel', traits: traits(b) }) : null] })),
    });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
  };

  test('dos galaxias de la misma paleta activan la Resonancia cromática y dicen su bonus', async () => {
    show({ palette: 'solar_gold', galaxy_type: 'spiral', core: 'bright', background: 'cmb' }, { palette: 'solar_gold', galaxy_type: 'ring', core: 'quasar', background: 'starfield' });
    const panel = await screen.findByRole('region', { name: copy.hangar.sets });
    expect(within(panel).getByText('Resonancia cromática')).toBeInTheDocument();
    expect(within(panel).getByText(copy.hangar.setBonus.stat('elemental', 0.25))).toBeInTheDocument();
  });

  test('una espiral con una galaxia satélite activa el Brazo satélite', async () => {
    show({ galaxy_type: 'spiral', palette: 'solar_gold' }, { phenomenon: 'satellite_galaxy', palette: 'ultraviolet', background: 'cmb', core: 'bright' });
    const panel = await screen.findByRole('region', { name: copy.hangar.sets });
    expect(within(panel).getByText('Brazo satélite')).toBeInTheDocument();
    expect(within(panel).getByText(copy.hangar.setBonus.stat('projectiles', 1))).toBeInTheDocument();
  });

  test('a medio hacer, dice qué galaxia falta', async () => {
    show({ galaxy_type: 'spiral' });
    const panel = await screen.findByRole('region', { name: copy.hangar.sets });
    expect(within(panel).getByText('Brazo satélite')).toBeInTheDocument();
    expect(within(panel).getByText(copy.hangar.setMissing('phenomenon', 'Galaxia satélite'))).toBeInTheDocument();
  });

  test('sin galaxias que encajen, explica cómo se consiguen', async () => {
    show({ galaxy_type: 'dwarf' });
    const panel = await screen.findByRole('region', { name: copy.hangar.sets });
    expect(within(panel).getByText(copy.hangar.setsEmpty)).toBeInTheDocument();
  });
});

test('un cambio de equipo rechazado se dice junto a las ranuras', async () => {
  const page: CollectionPage = { items: [galaxy()], counts: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 1 }, fusion: { count: 5, dust: [20, 50, 120, 300] } };
  mockApi({
    'GET /galaxy/api/hangar': () => jsonResponse(200, view()),
    'GET /galaxy/api/galaxies?sort=rarity&limit=30': () => jsonResponse(200, page),
    'PUT /galaxy/api/hangar/loadout': () => jsonResponse(409, { error: 'invalid_loadout' }),
  });
  renderAt('/incursion', { '/incursion': <HangarScreen /> });
  fireEvent.click((await screen.findAllByRole('button', { name: copy.hangar.chooseRelic }))[0]!);
  const picker = await screen.findByRole('dialog', { name: copy.hangar.pickerTitle });
  fireEvent.click((await within(picker).findAllByRole('button', { name: /^Equipar / }))[0]!);
  const relics = screen.getByRole('region', { name: copy.hangar.relics });
  expect(await within(relics).findByText(copy.errors.invalid_loadout)).toBeInTheDocument();
});
