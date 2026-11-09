import type { CollectionPage, FinishRunRequest, RunResult } from '@galaxy/shared';
import { DEFAULT_CONTENT, describeRelic } from '@galaxy/sim';
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

import { galaxy, SECTORS, view } from './hangar-fixtures';

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
  progress: { xp: 0, level: 1, levelUp: false, points: 0 },
};

const body: FinishRunRequest = { outcome: 'extracted', ticks: 21600, depth: 1, kills: 640, bossKills: 1, level: 15, loot: [{ coins: 40, dust: 12 }], hash: '0123456789abcdef', inputs: 'AQEA' };

beforeEach(() => {
  localStorage.clear();
  arena.props = null;
  arena.fail = false;
});

test('el Hangar muestra el sector, la sonda, 2 ranuras abiertas, la siguiente con su hito y 3 cerradas, y el premio del día', async () => {
  mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view()) });
  renderAt('/incursion', { '/incursion': <HangarScreen /> });
  expect(await screen.findByRole('heading', { name: 'Nebulosa Exterior' })).toBeInTheDocument();
  expect(screen.getByText('La Colmena Rota')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Lumen' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: copy.hangar.chooseRelic })).toHaveLength(2);
  // Slot 3 shows what opens it (M4c-1); the other three stay closed.
  expect(screen.getByRole('group', { name: copy.hangar.slot(3) })).toBeInTheDocument();
  expect(screen.getAllByText(copy.hangar.lockedSlot)).toHaveLength(3);
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
  summary: { ticks: 21600, outcome: 'dead', depth: 1, kills: 640, bossKills: 0, level: 15, loot: [{ coins: 40.6, dust: 12.2, components: 0 }], hash: '0123456789abcdef' },
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
  /** The lobby with these relics, and their sets' window open. */
  const show = async (a: Record<string, string>, b?: Record<string, string>) => {
    mockApi({
      'GET /galaxy/api/hangar': () =>
        jsonResponse(200, view({ loadout: [galaxy({ id: 'a', name: 'Kathra', traits: traits(a) }), b ? galaxy({ id: 'b', name: 'Orvel', traits: traits(b) }) : null] })),
    });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${copy.hangar.sets}`) }));
  };

  test('dos galaxias de la misma paleta activan la Resonancia cromática y dicen su bonus', async () => {
    await show({ palette: 'solar_gold', galaxy_type: 'spiral', core: 'bright', background: 'cmb' }, { palette: 'solar_gold', galaxy_type: 'ring', core: 'quasar', background: 'starfield' });
    const panel = await screen.findByRole('region', { name: copy.hangar.sets });
    expect(within(panel).getByText('Resonancia cromática')).toBeInTheDocument();
    expect(within(panel).getByText(copy.hangar.setBonus.stat('elemental', 0.25))).toBeInTheDocument();
  });

  test('una espiral con una galaxia satélite activa el Brazo satélite', async () => {
    await show({ galaxy_type: 'spiral', palette: 'solar_gold' }, { phenomenon: 'satellite_galaxy', palette: 'ultraviolet', background: 'cmb', core: 'bright' });
    const panel = await screen.findByRole('region', { name: copy.hangar.sets });
    expect(within(panel).getByText('Brazo satélite')).toBeInTheDocument();
    expect(within(panel).getByText(copy.hangar.setBonus.stat('projectiles', 1))).toBeInTheDocument();
  });

  test('a medio hacer, dice qué galaxia falta', async () => {
    await show({ galaxy_type: 'spiral' });
    const panel = await screen.findByRole('region', { name: copy.hangar.sets });
    expect(within(panel).getByText('Brazo satélite')).toBeInTheDocument();
    expect(within(panel).getByText(copy.hangar.setMissing('phenomenon', 'Galaxia satélite'))).toBeInTheDocument();
  });

  test('sin galaxias que encajen, explica cómo se consiguen', async () => {
    await show({ galaxy_type: 'dwarf' });
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


describe('la siguiente ranura de reliquia (M4c-1)', () => {
  const gacha = (dust: number) => ({ banners: [], costs: { coins: 100, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 0, dust, signal: 0 } });

  test('sin el hito, la ranura 3 enseña lo que la abre con su barra; las demás siguen cerradas', async () => {
    mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view()), 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha(500)) });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    const slot = await screen.findByRole('group', { name: copy.hangar.slot(3) });
    expect(slot).toHaveTextContent(copy.hangar.unlock.runs(5));
    const bar = within(slot).getByRole('progressbar', { name: copy.hangar.unlock.runs(5) });
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar).toHaveAttribute('aria-valuetext', copy.hangar.slotProgress(2, 5));
    expect(within(slot).queryByRole('button')).toBeNull();
    expect(screen.getAllByText(copy.hangar.lockedSlot)).toHaveLength(3);
  });

  test('con el hito, Abrir ranura con su polvo envía la ranura con su clave', async () => {
    const ready = view({ nextSlot: { slot: 3, condition: { stat: 'runs', value: 5 }, progress: 1, dust: 100, ready: true } });
    const fetch = mockApi({
      'GET /galaxy/api/hangar': () => jsonResponse(200, ready),
      'GET /galaxy/api/gacha': () => jsonResponse(200, gacha(500)),
      'POST /galaxy/api/hangar/slots/unlock': () => jsonResponse(200, view({ slots: 3, loadout: [null, null, null], nextSlot: { slot: 4, condition: { stat: 'bossKills', value: 3 }, progress: 0, dust: 300, ready: false } })),
    });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    const slot = await screen.findByRole('group', { name: copy.hangar.slot(3) });
    const open = within(slot).getByRole('button', { name: new RegExp(copy.hangar.openSlot) });
    await waitFor(() => expect(open).toBeEnabled());
    expect(open).toHaveTextContent(copy.collection.levelCost(100));
    fireEvent.click(open);
    await waitFor(() => expect(screen.getAllByRole('button', { name: copy.hangar.chooseRelic })).toHaveLength(3));
    const call = fetch.mock.calls.find(([url, init]) => url === '/galaxy/api/hangar/slots/unlock' && init?.method === 'POST')!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ slot: 3 });
    expect((call[1]!.headers as Record<string, string>)['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('sin polvo, Abrir ranura está desactivado y dice cuánto falta', async () => {
    const ready = view({ nextSlot: { slot: 3, condition: { stat: 'runs', value: 5 }, progress: 1, dust: 100, ready: true } });
    mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, ready), 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha(30)) });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    const slot = await screen.findByRole('group', { name: copy.hangar.slot(3) });
    await waitFor(() => expect(slot).toHaveTextContent(copy.lab.missing(70, 0)));
    const open = within(slot).getByRole('button', { name: new RegExp(copy.hangar.openSlot) });
    expect(open).toBeDisabled();
    // What is missing is the disabled button's description, for a screen reader too.
    expect(open).toHaveAccessibleDescription(copy.lab.missing(70, 0));
  });
});

describe('la misma familia apilada (M4c-1, GDD §8.6)', () => {
  test('la tercera reliquia de una familia dice la mitad de potencia que la anterior y el Hangar explica la regla', async () => {
    const spiral = (id: string) => galaxy({ id, name: `Espiral ${id}` });
    mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view({ slots: 3, loadout: [spiral('s1'), spiral('s2'), spiral('s3')], nextSlot: { slot: 4, condition: { stat: 'bossKills', value: 3 }, progress: 0, dust: 300, ready: false } })) });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    const power = async (n: number) => (await screen.findByRole('group', { name: copy.hangar.slot(n) })).querySelector('.lobby-slot-power')!.textContent;
    const inputs = ['s1', 's2', 's3'].map((id) => ({ id, seed: '12345', tier: 4, level: 1, traits: spiral(id).traits }));
    const second = describeRelic(inputs[1]!, inputs, DEFAULT_CONTENT).magnitude;
    expect(await power(2)).toBe(copy.hangar.power(second));
    expect(await power(3)).toBe(copy.hangar.power(second * DEFAULT_CONTENT.relics.stacking.decay));
    expect(screen.getByText(copy.hangar.stacking)).toBeInTheDocument();
  });

  test('con dos de cada familia no hay regla que explicar', async () => {
    mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view({ loadout: [galaxy({ id: 'a' }), galaxy({ id: 'b' })] })) });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    await screen.findByRole('group', { name: copy.hangar.slot(2) });
    expect(screen.queryByText(copy.hangar.stacking)).toBeNull();
  });
});

test('la peculiaridad y el rendimiento diario dicen los números de la configuración viva', () => {
  // An admin can change a quirk's numbers in the content and the daily hours in the economy: the texts follow.
  const q = copy.probeTest.quirks;
  expect(q.dash({ kind: 'dash', every: 20, distance: 50, invuln: 0.3 })).toBe('Esquiva un golpe con un salto, cada 20 s');
  expect(q.salvage({ kind: 'salvage', kills: 40 })).toBe('Cada 40 bajas encuentra un kit de reparación');
  expect(q.magnet({ kind: 'magnet', every: 45, radius: 160 })).toBe('Cada 45 s atrae los fragmentos cercanos');
  expect(q.thorns({ kind: 'thorns', share: 0.3 })).toBe('Devuelve el 30 % del daño a quien la toca');
  expect(q.overwatch({ kind: 'overwatch', drones: 2 })).toBe('Siempre lleva 2 drones de más');
  expect(copy.hangar.dailyHint(4)).toBe('Tras 4 horas de juego al día, el premio económico baja poco a poco. La experiencia y el progreso nunca bajan');
});

describe('el lobby', () => {
  const l = copy.lobby;
  test('pulsar la sonda abre el taller con ella', async () => {
    mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view()) });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    expect(await screen.findByRole('link', { name: l.toWorkshop('Lumen') })).toHaveAttribute('href', '/taller?sonda=lumen');
  });

  test('las flechas cambian la sonda con la que se vuela, entre las que se tienen', async () => {
    const fetch = mockApi({
      'GET /galaxy/api/hangar': () => jsonResponse(200, view()),
      'PUT /galaxy/api/hangar/probe': (b) => jsonResponse(200, view({ probe: (b as { probe: string }).probe })),
    });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    fireEvent.click(await screen.findByRole('button', { name: l.nextProbe }));
    expect(await screen.findByRole('heading', { name: 'Bastión' })).toBeInTheDocument();
    const put = fetch.mock.calls.find(([u, init]) => u === '/galaxy/api/hangar/probe' && init?.method === 'PUT');
    expect(JSON.parse(String(put![1]!.body))).toEqual({ probe: 'bastion' });
  });

  test('con una sola sonda no hay flechas', async () => {
    mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view({ probes: view().probes.map((p) => (p.id === 'lumen' ? p : { ...p, unlocked: false })) })) });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    expect(await screen.findByRole('heading', { name: 'Lumen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: l.nextProbe })).not.toBeInTheDocument();
  });

  test('los pasos van en orden: con quién, dónde y con qué, y las zonas del juego a un toque', async () => {
    mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view()) });
    renderAt('/incursion', { '/incursion': <HangarScreen /> });
    const who = await screen.findByRole('radiogroup', { name: l.who });
    expect(within(who).getByRole('radio', { name: new RegExp(l.solo) })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('complementary', { name: l.where })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: copy.hangar.relics })).toHaveTextContent(l.what);
    const zones = screen.getByRole('navigation', { name: l.zones });
    expect(within(zones).getByRole('link', { name: l.zone.workshop })).toHaveAttribute('href', '/taller');
    expect(within(zones).getAllByRole('link')).toHaveLength(6);
  });
});

test('cada reliquia lleva un chip con sus poderes, que abre lo que hace cada uno', async () => {
  const i = copy.hangar.skillInfo;
  mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view({ loadout: [galaxy(), null] })) });
  renderAt('/incursion', { '/incursion': <HangarScreen /> });
  const slot = await screen.findByRole('group', { name: copy.hangar.slot(1) });
  // One chip: the passive and how many more.
  const chip = within(slot).getByRole('button', { name: i.open('Kathra') });
  expect(chip).toHaveTextContent(copy.hangar.families.blades);
  expect(chip).toHaveTextContent('+2');
  fireEvent.click(chip);
  const info = await screen.findByRole('dialog', { name: i.title('Kathra') });
  const powers = within(info).getByRole('list', { name: i.tags('Kathra') });
  const rows = within(powers).getAllByRole('listitem');
  expect(rows).toHaveLength(4);
  expect(rows[0]).toHaveTextContent(i.family.blades);
  expect(rows[1]).toHaveTextContent(i.element.burn);
  expect(rows[2]).toHaveTextContent(i.phenomenon.pulsar);
  expect(rows[3]).toHaveTextContent(i.power);
});
