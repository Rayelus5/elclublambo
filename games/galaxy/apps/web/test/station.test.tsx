import type { StationView } from '@galaxy/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { StationScreen } from '../src/station/StationScreen';
import { jsonResponse, mockApi, renderAt } from './render';

// The station (GDD §10): the rooms as the menu, the broken ones in sight, the refinery and the antenna in their panels,
// every action sent once with its key and answered with the new view.

const t = copy.station;

const view = (over: Partial<StationView> = {}): StationView => ({
  rooms: [
    { id: 'scanner', state: 'working', level: 1, maxLevel: 1, next: null },
    { id: 'planetarium', state: 'working', level: 1, maxLevel: 1, next: null },
    { id: 'lab', state: 'future', level: 0, maxLevel: 0, next: null },
    { id: 'hangar', state: 'working', level: 1, maxLevel: 1, next: null },
    { id: 'collider', state: 'working', level: 1, maxLevel: 1, next: null },
    { id: 'comms', state: 'working', level: 1, maxLevel: 1, next: null },
    { id: 'refinery', state: 'working', level: 1, maxLevel: 5, next: { cost: { components: 40, coins: 500 } } },
    { id: 'antenna', state: 'broken', level: 0, maxLevel: 5, next: { cost: { components: 30, coins: 0 } } },
    { id: 'archive', state: 'future', level: 0, maxLevel: 0, next: null },
    { id: 'trophies', state: 'future', level: 0, maxLevel: 0, next: null },
  ],
  refinery: { level: 1, rate: 20, capacity: 100, queue: 30, ready: 20, nextAt: '2026-11-07T11:03:00.000Z' },
  antenna: { level: 0, rate: 0, capHours: 8, accrued: 0, fullAt: null },
  wallet: { coins: 300, dust: 10, signal: 4, material: 45, components: 12 },
  ...over,
});

function open(v = view(), routes: Record<string, (b: unknown) => Response> = {}) {
  const fetch = mockApi({ 'GET /galaxy/api/station': () => jsonResponse(200, v), ...routes });
  renderAt('/estacion', { '/estacion': <StationScreen /> });
  return fetch;
}
afterEach(() => {
  vi.useRealTimers();
});
/** Pins the browser clock (local time) without faking timers, so queries and waits still run. */
const at = (local: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(local));
};
const sent = (fetch: ReturnType<typeof mockApi>, path: string) => fetch.mock.calls.filter(([url, init]) => url === `/galaxy/api/station/${path}` && init?.method === 'POST');

test('las diez salas: las que funcionan llevan a su pantalla y las de más adelante dicen «En reparación»', async () => {
  open();
  const deck = await screen.findByRole('list', { name: t.title });
  expect(within(deck).getAllByRole('listitem')).toHaveLength(10);
  // The hangar room is the probes' Taller.
  expect(within(deck).getByRole('link', { name: new RegExp(t.rooms.hangar) })).toHaveAttribute('href', '/taller');
  expect(within(deck).getByRole('link', { name: new RegExp(t.rooms.scanner) })).toHaveAttribute('href', '/escaner');
  expect(within(deck).getByRole('link', { name: new RegExp(t.rooms.planetarium) })).toHaveAttribute('href', '/planetario');
  expect(within(deck).getByRole('link', { name: new RegExp(t.rooms.collider) })).toHaveAttribute('href', '/coleccion');
  for (const id of ['lab', 'archive', 'trophies'] as const) {
    const item = within(deck).getByText(t.rooms[id]).closest('li')!;
    expect(item).toHaveTextContent(t.repairing);
    expect(within(item).queryByRole('button')).toBeNull();
    expect(within(item).queryByRole('link')).toBeNull();
  }
  // Each room plays its Aseprite strip: the antenna broken, the refinery at its level.
  expect(within(deck).getByText(t.rooms.antenna).closest('li')!.querySelector('.room-art')).toHaveAttribute('data-sheet', 'antenna-broken');
  expect(within(deck).getByText(t.rooms.refinery).closest('li')!.querySelector('.room-art')).toHaveAttribute('data-sheet', 'refinery-1');
  expect(within(deck).getByText(t.rooms.lab).closest('li')!.querySelector('.room-art')).toHaveAttribute('data-sheet', 'lab-broken');
  // Raw material and components in the bar, read as sentences; material opens the refinery.
  expect(screen.getByRole('button', { name: new RegExp(t.resource.material(45)) })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: t.resource.components(12) })).toBeInTheDocument();
});

test('la Antena rota se repara con componentes: sin los suficientes, el botón está desactivado', async () => {
  open();
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(t.rooms.antenna) }));
  const dialog = screen.getByRole('dialog', { name: t.rooms.antenna });
  expect(dialog).toHaveTextContent(t.antenna.broken);
  // The repair says its cost in its name (the chips show it with icons).
  expect(within(dialog).getByRole('button', { name: `${t.repair}: ${t.cost(30, 0)}` })).toBeDisabled();
  // And it says what is missing: 12 of 30 components.
  expect(dialog).toHaveTextContent(t.missing(18, 0));
});

test('reparar la Antena envía la mejora con su clave y enseña la vista nueva', async () => {
  const repaired = view({
    rooms: view().rooms.map((r) => (r.id === 'antenna' ? { ...r, state: 'working', level: 1, next: { cost: { components: 40, coins: 400 } } } : r)),
    antenna: { level: 1, rate: 0.125, capHours: 8, accrued: 0, fullAt: '2026-11-07T18:00:00.000Z' },
    wallet: { ...view().wallet, components: 0 },
  });
  const fetch = open(view({ wallet: { ...view().wallet, components: 30 } }), { 'POST /galaxy/api/station/rooms/antenna/upgrade': () => jsonResponse(200, repaired) });
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(t.rooms.antenna) }));
  fireEvent.click(within(screen.getByRole('dialog', { name: t.rooms.antenna })).getByRole('button', { name: new RegExp(t.repair) }));
  expect(await screen.findByText(t.antenna.accrued(0))).toBeInTheDocument();
  const call = sent(fetch, 'rooms/antenna/upgrade')[0]!;
  expect((call[1]!.headers as Record<string, string>)['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  // It says which level it expects, so a stale view never buys the next one.
  expect(JSON.parse(String(call[1]!.body))).toEqual({ level: 1 });
});

test('la refinería: su ritmo, su cola, cargar lo que cabe, recoger lo listo y mejorar con su coste', async () => {
  const fetch = open(view(), {
    'POST /galaxy/api/station/refinery/load': () => jsonResponse(200, view({ refinery: { ...view().refinery, queue: 75 }, wallet: { ...view().wallet, material: 0 } })),
    'POST /galaxy/api/station/refinery/collect': () => jsonResponse(200, view({ refinery: { ...view().refinery, ready: 0 }, wallet: { ...view().wallet, components: 32 } })),
  });
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(t.rooms.refinery) }));
  const dialog = screen.getByRole('dialog', { name: t.rooms.refinery });
  expect(dialog).toHaveTextContent(t.refinery.rate(20));
  expect(within(dialog).getByRole('progressbar', { name: t.refinery.queue })).toHaveAttribute('aria-valuenow', '30');
  // By default all the material that fits: 45 in hand, 70 free in the queue; the presets pick a share of it.
  const slider = within(dialog).getByRole('slider', { name: t.refinery.amount });
  expect(slider).toHaveValue('45');
  fireEvent.click(within(dialog).getByRole('button', { name: t.refinery.half }));
  expect(slider).toHaveValue('22');
  fireEvent.click(within(dialog).getByRole('button', { name: t.refinery.all }));
  fireEvent.click(within(dialog).getByRole('button', { name: t.refinery.loadN(45) }));
  await waitFor(() => expect(within(dialog).getByRole('progressbar', { name: t.refinery.queue })).toHaveAttribute('aria-valuenow', '75'));
  // Nothing left in hand: the loader goes away.
  expect(within(dialog).queryByRole('slider')).toBeNull();
  expect(JSON.parse(String(sent(fetch, 'refinery/load')[0]![1]!.body))).toEqual({ amount: 45 });
  fireEvent.click(within(dialog).getByRole('button', { name: t.refinery.collect(20) }));
  expect(await screen.findByRole('img', { name: t.resource.components(32) })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: `${t.upgrade(2)}: ${t.cost(40, 500)}` })).toBeInTheDocument();
});

test('un error del servidor se dice en el panel', async () => {
  open(view(), { 'POST /galaxy/api/station/refinery/load': () => jsonResponse(409, { error: 'refinery_full' }) });
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(t.rooms.refinery) }));
  const dialog = screen.getByRole('dialog', { name: t.rooms.refinery });
  fireEvent.click(within(dialog).getByRole('button', { name: t.refinery.loadN(45) }));
  expect(await within(dialog).findByText(copy.errors.refinery_full)).toBeInTheDocument();
});

test('la Antena funcionando: lo que espera, su ritmo, cuándo se llena y recoger', async () => {
  at('2026-11-07T12:00:00');
  const fullAt = new Date('2026-11-07T18:00:00').toISOString();
  const working = view({
    rooms: view().rooms.map((r) => (r.id === 'antenna' ? { ...r, state: 'working', level: 1, next: { cost: { components: 40, coins: 400 } } } : r)),
    antenna: { level: 1, rate: 0.125, capHours: 8, accrued: 3, fullAt },
  });
  const fetch = open(working, {
    'POST /galaxy/api/station/antenna/collect': () => jsonResponse(200, { ...working, antenna: { ...working.antenna, accrued: 0 }, wallet: { ...working.wallet, signal: 7 } }),
  });
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(t.rooms.antenna) }));
  const dialog = screen.getByRole('dialog', { name: t.rooms.antenna });
  expect(dialog).toHaveTextContent(t.antenna.accrued(3));
  expect(dialog).toHaveTextContent(t.antenna.rate(0.125));
  expect(dialog).toHaveTextContent(t.antenna.fullAt('18:00', 'today'));
  expect(within(dialog).getByRole('progressbar', { name: t.antenna.fill })).toHaveAttribute('aria-valuenow', '1');
  fireEvent.click(within(dialog).getByRole('button', { name: t.antenna.collectN(3) }));
  expect(await screen.findByRole('link', { name: new RegExp(copy.hub.resource.signal(7)) })).toBeInTheDocument();
  expect(sent(fetch, 'antenna/collect')).toHaveLength(1);
});

test('el panel se lleva el foco, Escape lo cierra y el foco vuelve a la sala', async () => {
  open();
  const room = await screen.findByRole('button', { name: new RegExp(t.rooms.refinery) });
  room.focus();
  fireEvent.click(room);
  const dialog = screen.getByRole('dialog', { name: t.rooms.refinery });
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(room).toHaveFocus();
});

test('la Antena llena dice que ya está llena, y si se llena otro día dice cuál', async () => {
  const working = (fullAt: string, accrued: number) =>
    view({
      rooms: view().rooms.map((r) => (r.id === 'antenna' ? { ...r, state: 'working', level: 1, next: { cost: { components: 40, coins: 400 } } } : r)),
      antenna: { level: 1, rate: 0.125, capHours: 24, accrued, fullAt: new Date(fullAt).toISOString() },
    });
  // Came back the next evening: it filled up this morning.
  at('2026-11-08T20:00:00');
  open(working('2026-11-08T06:00:00', 3));
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(t.rooms.antenna) }));
  let dialog = screen.getByRole('dialog', { name: t.rooms.antenna });
  expect(dialog).toHaveTextContent(t.antenna.full);
  expect(dialog).not.toHaveTextContent(/Se llena (a las|mañana|el )/);
  // How long it takes to fill is live config.
  expect(dialog).toHaveTextContent(t.antenna.lead(24));
  fireEvent.keyDown(dialog, { key: 'Escape' });
  cleanup();
  // Collected late at night: it fills tomorrow.
  at('2026-11-08T22:00:00');
  open(working('2026-11-09T06:30:00', 0));
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(t.rooms.antenna) }));
  dialog = screen.getByRole('dialog', { name: t.rooms.antenna });
  expect(dialog).toHaveTextContent(t.antenna.fullAt('06:30', 'tomorrow'));
});

test('el Laboratorio roto abre su panel con Reparar y su coste; arreglado, lleva a su pantalla (M4b-2)', async () => {
  const broken = view({
    rooms: view().rooms.map((r) => (r.id === 'lab' ? { id: 'lab', state: 'broken', level: 0, maxLevel: 1, next: { cost: { components: 50, coins: 500 } } } : r)),
  });
  open(broken);
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(t.rooms.lab) }));
  const dialog = screen.getByRole('dialog', { name: t.rooms.lab });
  expect(dialog).toHaveTextContent(t.labLead);
  expect(within(dialog).getByRole('button', { name: `${t.repair}: ${t.cost(50, 500)}` })).toBeInTheDocument();
});

test('el Laboratorio arreglado es un enlace a /laboratorio', async () => {
  open(view({ rooms: view().rooms.map((r) => (r.id === 'lab' ? { id: 'lab', state: 'working', level: 1, maxLevel: 1, next: null } : r)) }));
  const deck = await screen.findByRole('list', { name: t.title });
  expect(within(deck).getByRole('link', { name: new RegExp(t.rooms.lab) })).toHaveAttribute('href', '/laboratorio');
});

test('una máquina con algo que recoger lo dice en su placa (pulido de M8)', async () => {
  open();
  const deck = await screen.findByRole('list', { name: t.title });
  expect(within(deck).getByText(t.rooms.refinery).closest('li')!).toHaveTextContent(t.ready);
  expect(within(deck).getByText(t.rooms.antenna).closest('li')!).not.toHaveTextContent(t.ready);
});

test('la mejora compara lo de ahora con el siguiente nivel', async () => {
  const withGives = view({ rooms: view().rooms.map((r) => (r.id === 'refinery' ? { ...r, next: { cost: { components: 40, coins: 500 }, gives: { rate: 30, capacity: 150 } } } : r)) });
  open(withGives);
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(t.rooms.refinery) }));
  const dialog = screen.getByRole('dialog', { name: t.rooms.refinery });
  expect(dialog).toHaveTextContent(`${t.refinery.rateLabel}${t.refinery.rate(20)}${t.refinery.rate(30)}`);
  expect(dialog).toHaveTextContent(`${t.refinery.capacityLabel}100150`);
});

test('Comunicaciones abre su panel con Mercado, Trueques, Buzón, Comunidad y Clanes', async () => {
  open();
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(t.rooms.comms) }));
  const dialog = screen.getByRole('dialog', { name: t.rooms.comms });
  expect(within(dialog).getByRole('link', { name: new RegExp(t.comms.market) })).toHaveAttribute('href', '/mercado');
  expect(within(dialog).getByRole('link', { name: new RegExp(t.comms.trades) })).toHaveAttribute('href', '/mercado?pestana=trueques');
  expect(within(dialog).getByRole('button', { name: new RegExp(t.comms.mail) })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: new RegExp(t.comms.community) })).toBeInTheDocument();
  expect(within(dialog).getByRole('link', { name: new RegExp(t.comms.clans) })).toHaveAttribute('href', '/clanes');
});
