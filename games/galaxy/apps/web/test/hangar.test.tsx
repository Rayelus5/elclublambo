import type { CollectionPage, FinishRunRequest, GalaxySummary, HangarView, ProbeCard, RunResult, SectorCard } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { levelOne } from './probe-cards';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { clearPending, loadPending, savePending } from '../src/api/pending-run';
import type { RunEnd } from '../src/arena/ArenaScreen';
import { copy } from '../src/copy/es';
import { HangarScreen } from '../src/hangar/HangarScreen';
import { jsonResponse, locationOf, mockApi, renderAt } from './render';

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

/** A probe card from the default content: locked with no condition unless told otherwise. */
const card = (id: string, over: Partial<ProbeCard> = {}): ProbeCard => {
  const p = DEFAULT_CONTENT.probes.find((x) => x.id === id)!;
  const w = DEFAULT_CONTENT.weapons.find((x) => x.id === p.weapon)!;
  return { id, name: p.name, description: p.description, sprite: p.sprite, hp: p.hp, speed: p.speed, weapon: { id: w.id, name: w.name, icon: w.icon }, quirk: p.quirk?.kind ?? null, unlocked: false, condition: null, progress: 0, ...levelOne(p), ...over };
};

// The test gave Lumen; Bastión is earned (3 runs), Chispa is one run in; the others have their conditions.
const PROBES: ProbeCard[] = [
  card('lumen', { unlocked: true, progress: 1 }),
  card('bastion', { unlocked: true, condition: { stat: 'runs', value: 3 }, progress: 1 }),
  card('spark', { condition: { stat: 'runs', value: 3 }, progress: 1 / 3 }),
  card('sentinel', { condition: { stat: 'bossKills', value: 3 }, progress: 0 }),
  card('anchor', { condition: { stat: 'maxDepth', value: 4 }, progress: 2 / 4 }),
  card('prism', { condition: { stat: 'extractions', value: 5 }, progress: 1 / 5 }),
  card('comet', { condition: { stat: 'kills', value: 2000 }, progress: 1999 / 2000 }),
  card('echo', { condition: { stat: 'runs', value: 15 }, progress: 1 / 15 }),
];

/** A sector card from the default content: locked with no condition unless told otherwise. */
const sectorCard = (id: string, over: Partial<SectorCard> = {}): SectorCard => {
  const sec = DEFAULT_CONTENT.sectors.find((x) => x.id === id)!;
  const boss = DEFAULT_CONTENT.bosses.find((b) => b.id === sec.boss)!;
  const fauna = [...new Set(sec.spawns.map((sp) => sp.enemy))].map((e) => DEFAULT_CONTENT.enemies.find((x) => x.id === e)!);
  return {
    id,
    name: sec.name,
    description: sec.description,
    boss: { name: boss.name, title: boss.title, sprite: boss.sprite },
    fauna: fauna.map((e) => ({ id: e.id, name: e.name, sprite: e.sprite })),
    layerSeconds: sec.layerSeconds,
    biome: sec.biome,
    unlocked: false,
    condition: null,
    progress: 0,
    season: sec.season,
    ...over,
  };
};

// A new account: the Nebulosa open, the chain closed, the season open.
const SECTORS: SectorCard[] = [
  sectorCard('outer-nebula', { unlocked: true, progress: 1 }),
  sectorCard('frost-rings', { condition: { sector: 'outer-nebula', stat: 'bossKills', value: 1 } }),
  sectorCard('hollow-reef', { condition: { sector: 'frost-rings', stat: 'bossKills', value: 1 } }),
  sectorCard('broken-forge', { condition: { sector: 'hollow-reef', stat: 'bossKills', value: 1 } }),
  sectorCard('signal-rift', { unlocked: true, progress: 1 }),
];

const view = (over: Partial<HangarView> = {}): HangarView => ({
  sectors: SECTORS,
  sector: 'outer-nebula',
  probes: PROBES,
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
  payout: { coins: 40, dust: 12, signals: 1, material: 28 },
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

describe('el selector de sectores', () => {
  test('muestra los 5: el elegido marcado, los cerrados con lo que los abre, y la temporada abierta', async () => {
    mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view()) });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    const picker = await screen.findByRole('list', { name: copy.hangar.sectorPicker });
    expect(within(picker).getAllByRole('listitem')).toHaveLength(5);
    expect(within(picker).getByRole('button', { name: 'Nebulosa Exterior' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(picker).queryByRole('button', { name: 'Anillos de Escarcha' })).toBeNull();
    expect(within(picker).getByText(copy.hangar.sectorUnlock.bossKills(1, 'La Colmena Rota', 'Nebulosa Exterior'))).toBeInTheDocument();
    expect(within(picker).getByText(copy.hangar.sectorUnlock.bossKills(1, 'La Madre Glaciar', 'Anillos de Escarcha'))).toBeInTheDocument();
    const frost = within(picker).getByRole('progressbar', { name: 'Anillos de Escarcha' });
    expect(frost).toHaveAttribute('aria-valuenow', '0');
    expect(frost).toHaveAttribute('aria-valuemax', '1');
    const rift = within(picker).getByRole('button', { name: 'Fisura de la Señal' });
    expect(rift).toHaveAttribute('aria-pressed', 'false');
    expect(rift).toHaveTextContent(copy.hangar.seasonBadge);
    expect(screen.queryByText('Más sectores en desarrollo')).toBeNull();
  });

  test('elegir otro abierto lo envía y lo muestra, con su insignia de temporada, y Lanzar sale con él', async () => {
    const fetch = mockApi({
      'GET /galaxy/api/hangar': () => jsonResponse(200, view()),
      'PUT /galaxy/api/hangar/sector': (b) => jsonResponse(200, view({ sector: (b as { sector: string }).sector })),
      'POST /galaxy/api/runs': () => jsonResponse(200, { ...started, sector: 'signal-rift' }),
    });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    const picker = await screen.findByRole('list', { name: copy.hangar.sectorPicker });
    fireEvent.click(within(picker).getByRole('button', { name: 'Fisura de la Señal' }));
    expect(await screen.findByRole('heading', { name: 'Fisura de la Señal' })).toBeInTheDocument();
    expect(within(picker).getByRole('button', { name: 'Fisura de la Señal' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('La Señal')).toBeInTheDocument();
    const put = fetch.mock.calls.find(([url, init]) => url === '/galaxy/api/hangar/sector' && init?.method === 'PUT')!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({ sector: 'signal-rift' });
    fireEvent.click(screen.getByRole('button', { name: copy.hangar.launch }));
    await screen.findByTestId('arena');
    const run = fetch.mock.calls.find(([url]) => url === '/galaxy/api/runs')!;
    expect(JSON.parse(String(run[1]!.body)).sector).toBe('signal-rift');
  });

  test('si el servidor no lo deja elegir lo dice y sigue el de antes', async () => {
    mockApi({
      'GET /galaxy/api/hangar': () => jsonResponse(200, view()),
      'PUT /galaxy/api/hangar/sector': () => jsonResponse(409, { error: 'sector_locked' }),
    });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    const picker = await screen.findByRole('list', { name: copy.hangar.sectorPicker });
    fireEvent.click(within(picker).getByRole('button', { name: 'Fisura de la Señal' }));
    expect(await screen.findByText(copy.errors.sector_locked)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nebulosa Exterior' })).toBeInTheDocument();
  });

  test('con la temporada cerrada, la Fisura dice «Fuera de temporada» y no se elige', async () => {
    const sectors = SECTORS.map((x) => (x.id === 'signal-rift' ? { ...x, unlocked: false, progress: 0 } : x));
    mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view({ sectors })) });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    const picker = await screen.findByRole('list', { name: copy.hangar.sectorPicker });
    expect(within(picker).queryByRole('button', { name: 'Fisura de la Señal' })).toBeNull();
    expect(within(picker).getByText(copy.hangar.offSeason)).toBeInTheDocument();
  });
});

describe('el selector de sondas', () => {
  test('muestra las 8: la elegida marcada y su peculiaridad, las bloqueadas con su condición y su progreso', async () => {
    mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view()) });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    const picker = await screen.findByRole('list', { name: copy.hangar.probePicker });
    expect(within(picker).getAllByRole('listitem')).toHaveLength(8);
    expect(within(picker).getByRole('button', { name: 'Lumen' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(picker).getByRole('button', { name: 'Bastión' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(picker).queryByRole('button', { name: 'Chispa' })).toBeNull();
    expect(screen.getByText(copy.probeTest.quirks.magnet)).toBeInTheDocument();
    const spark = within(picker).getByRole('progressbar', { name: 'Chispa' });
    expect(spark).toHaveAttribute('aria-valuenow', '1');
    expect(spark).toHaveAttribute('aria-valuemax', '3');
    expect(within(picker).getByText(copy.hangar.unlock.bossKills(3))).toBeInTheDocument();
    expect(within(picker).getByText(copy.hangar.unlock.maxDepth(4))).toBeInTheDocument();
    expect(within(picker).getByText(copy.hangar.unlock.extractions(5))).toBeInTheDocument();
    expect(within(picker).getByText(copy.hangar.unlock.kills(2000))).toBeInTheDocument();
    expect(within(picker).getByText(copy.hangar.unlock.runs(15))).toBeInTheDocument();
    // 1999 of 2000 is not rounded up to a full bar.
    expect(within(picker).getByRole('progressbar', { name: 'Cometa' })).toHaveAttribute('aria-valuenow', '1999');
  });

  test('elegir una desbloqueada la envía y la muestra, y Lanzar sale con ella', async () => {
    const fetch = mockApi({
      'GET /galaxy/api/hangar': () => jsonResponse(200, view()),
      'PUT /galaxy/api/hangar/probe': (b) => jsonResponse(200, view({ probe: (b as { probe: string }).probe })),
      'POST /galaxy/api/runs': () => jsonResponse(200, { ...started, probe: 'bastion' }),
    });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    const picker = await screen.findByRole('list', { name: copy.hangar.probePicker });
    fireEvent.click(within(picker).getByRole('button', { name: 'Bastión' }));
    expect(await screen.findByRole('heading', { name: 'Bastión' })).toBeInTheDocument();
    expect(within(picker).getByRole('button', { name: 'Bastión' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(copy.probeTest.quirks.thorns)).toBeInTheDocument();
    const put = fetch.mock.calls.find(([url, init]) => url === '/galaxy/api/hangar/probe' && init?.method === 'PUT')!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({ probe: 'bastion' });
    fireEvent.click(screen.getByRole('button', { name: copy.hangar.launch }));
    await screen.findByTestId('arena');
    const run = fetch.mock.calls.find(([url]) => url === '/galaxy/api/runs')!;
    expect(JSON.parse(String(run[1]!.body)).probe).toBe('bastion');
  });

  test('si el servidor no la deja elegir lo dice y sigue la de antes', async () => {
    mockApi({
      'GET /galaxy/api/hangar': () => jsonResponse(200, view()),
      'PUT /galaxy/api/hangar/probe': () => jsonResponse(409, { error: 'probe_locked' }),
    });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    const picker = await screen.findByRole('list', { name: copy.hangar.probePicker });
    fireEvent.click(within(picker).getByRole('button', { name: 'Bastión' }));
    expect(await screen.findByText(copy.errors.probe_locked)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Lumen' })).toBeInTheDocument();
  });
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

test('sin el test de la sonda, el Hangar lleva al test', async () => {
  mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view({ test: { taken: false, probe: null } })) });
  renderAt('/incursion', { '/incursion': <HangarScreen /> });
  expect(locationOf(await screen.findByTestId('location')).pathname).toBe('/sonda');
});

describe('el nivel de la sonda y su arma inicial (M4b-1)', () => {
  const lumenDef = DEFAULT_CONTENT.probes.find((p) => p.id === 'lumen')!;
  /** The Hangar with Lumen at `level` (and its chosen weapon), and a wallet. */
  const at = (level: number, variant: string | null = null, wallet = { coins: 2000, dust: 0, signal: 0, components: 100 }) => {
    const probes = PROBES.map((p) => (p.id === 'lumen' ? { ...p, ...levelOne(lumenDef, level, variant) } : p));
    return {
      hangar: view({ probes }),
      gacha: { banners: [], costs: { coins: 100, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet },
    };
  };

  test('dice su nivel, lo que le da y cuánto cuesta subir', async () => {
    const { hangar, gacha } = at(3);
    mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, hangar), 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha) });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    expect(await screen.findByText(copy.hangar.level(3, 10))).toBeInTheDocument();
    expect(screen.getByText(copy.hangar.bonuses(hangar.probes[0]!.bonuses))).toBeInTheDocument();
    expect(copy.hangar.bonuses(hangar.probes[0]!.bonuses)).toBe('+6 % de vida y +4 % de daño');
    const up = await screen.findByRole('button', { name: new RegExp(copy.hangar.levelUp(4)) });
    await waitFor(() => expect(up).toBeEnabled());
    expect(up).toHaveTextContent(copy.station.cost(60, 1000));
    // The components a level costs are in the Hangar's balance.
    expect(screen.getByRole('img', { name: copy.station.resource.components(100) })).toBeInTheDocument();
  });

  test('sin fondos la subida está desactivada y dice cuánto falta', async () => {
    const { hangar, gacha } = at(3, null, { coins: 0, dust: 0, signal: 0, components: 10 });
    mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, hangar), 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha) });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    expect(await screen.findByText(copy.station.missing(50, 1000))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(copy.hangar.levelUp(4)) })).toBeDisabled();
  });

  test('subir envía el nivel con su clave y enseña la vista nueva', async () => {
    const { hangar, gacha } = at(3);
    const fetch = mockApi({
      'GET /galaxy/api/hangar': () => jsonResponse(200, hangar),
      'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
      'POST /galaxy/api/hangar/probes/lumen/level-up': () => jsonResponse(200, at(4).hangar),
    });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    const up = await screen.findByRole('button', { name: new RegExp(copy.hangar.levelUp(4)) });
    await waitFor(() => expect(up).toBeEnabled());
    fireEvent.click(up);
    expect(await screen.findByText(copy.hangar.level(4, 10))).toBeInTheDocument();
    const call = fetch.mock.calls.find(([url, init]) => url === '/galaxy/api/hangar/probes/lumen/level-up' && init?.method === 'POST')!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ level: 4 });
    expect((call[1]!.headers as Record<string, string>)['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('una subida rechazada (otra pestaña ya subió) dice el error y refresca el Hangar con el nivel de verdad', async () => {
    const { gacha } = at(3);
    let views = 0;
    mockApi({
      // The first view is stale (level 3); the server already has level 4.
      'GET /galaxy/api/hangar': () => jsonResponse(200, (views++ === 0 ? at(3) : at(4)).hangar),
      'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
      'POST /galaxy/api/hangar/probes/lumen/level-up': () => jsonResponse(409, { error: 'probe_changed' }),
    });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    const up = await screen.findByRole('button', { name: new RegExp(copy.hangar.levelUp(4)) });
    await waitFor(() => expect(up).toBeEnabled());
    fireEvent.click(up);
    expect(await screen.findByText(copy.errors.probe_changed)).toBeInTheDocument();
    expect(await screen.findByText(copy.hangar.level(4, 10))).toBeInTheDocument();
  });

  test('al nivel 10 dice Nivel máximo y no ofrece subir', async () => {
    const { hangar, gacha } = at(10);
    mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, hangar), 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha) });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    expect(await screen.findByText(copy.hangar.levelMax)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Subir a nivel/ })).toBeNull();
  });

  test('el arma inicial: la base y sus dos variantes, la del 8 cerrada; elegir la del 4 la envía y la marca', async () => {
    const { hangar, gacha } = at(4);
    const fetch = mockApi({
      'GET /galaxy/api/hangar': () => jsonResponse(200, hangar),
      'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
      'PUT /galaxy/api/hangar/probes/lumen/variant': () => jsonResponse(200, at(4, 'pulse-twin').hangar),
    });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    const group = await screen.findByRole('radiogroup', { name: copy.hangar.startingWeapon });
    expect(within(group).getByRole('radio', { name: /Pulso láser/ })).toBeChecked();
    expect(within(group).getByRole('radio', { name: /Pulso gélido/ })).toBeDisabled();
    expect(group).toHaveTextContent(copy.hangar.variantLocked(8));
    fireEvent.click(within(group).getByRole('radio', { name: /Pulso doble/ }));
    await waitFor(() => expect(within(group).getByRole('radio', { name: /Pulso doble/ })).toBeChecked());
    const put = fetch.mock.calls.find(([url, init]) => url === '/galaxy/api/hangar/probes/lumen/variant' && init?.method === 'PUT')!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({ variant: 'pulse-twin' });
  });
});
