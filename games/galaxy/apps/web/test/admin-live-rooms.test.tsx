import type { AdminLoadSample, RoomView } from '@galaxy/shared';
import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { LiveRooms } from '../src/admin/LiveRooms';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// Moderación › Salas en vivo (phase 7): a room playing its run links to watching it live; one in the lobby does not.

const r = copy.admin.moderation.rooms;
const RUN = '00000000-0000-4000-8000-0000000000d1';
const room = (code: string, state: RoomView['state'], run: RoomView['run']): RoomView & { idleSeconds: number } => ({
  id: `00000000-0000-4000-8000-${code === 'ABC234' ? '0000000000e1' : '0000000000e2'}`,
  code,
  kind: 'private',
  sector: 'outer-nebula',
  leader: 'vega',
  state,
  members: [{ username: 'vega', level: 3, probe: 'lumen', skin: null, ready: true, connected: true, leader: true }],
  max: 4,
  createdAt: '2026-11-09T10:00:00Z',
  canStart: false,
  run,
  idleSeconds: 12,
});

test('una sala que juega lleva a verla en directo; una que espera, no', async () => {
  mockApi({
    'GET /galaxy/api/admin/rooms': () => jsonResponse(200, { rooms: [room('ABC234', 'running', { id: RUN }), room('XYZ789', 'lobby', null)] }),
    'GET /galaxy/api/admin/solo/live': () => jsonResponse(200, { runs: [] }),
    'GET /galaxy/api/admin/load': () => jsonResponse(200, load()),
  });
  renderAt('/admin/moderacion/salas', { '/admin/moderacion/salas': <LiveRooms /> });
  const link = await screen.findByRole('link', { name: r.watchOf('ABC234') });
  expect(link).toHaveAttribute('href', `/admin/moderacion/directo/${RUN}`);
  expect(screen.queryByRole('link', { name: r.watchOf('XYZ789') })).not.toBeInTheDocument();
});

// The server's load (2026-11-17, the owner: «ver la carga del multijugador en el servidor desde el admin»): the numbers
// now in tiles, the last hour as small lines (each with its summary for screen readers) and the whole hour in a table.
const L = copy.admin.moderation.load;
const sample = (i: number, over: Partial<AdminLoadSample> = {}): AdminLoadSample => ({
  at: new Date(Date.parse('2026-11-17T12:00:00Z') + i * 15_000).toISOString(),
  rooms: { lobby: 3, starting: 0, running: 2, max: 10 },
  players: 9,
  coop: { runs: 2, connected: 7 },
  solo: 4,
  sockets: 31,
  referee: { core: 0.012, p99: 0.8 },
  loop: { p50: 11, p99: 24, max: 61 },
  cpu: 0.021,
  memory: { rss: 210 * 1024 * 1024, heap: 95 * 1024 * 1024 },
  uptime: 3720,
  ...over,
});
const load = () => ({ now: sample(9, { players: 12 }), history: Array.from({ length: 8 }, (_, i) => sample(i, { players: 4 + i })), sampleMs: 15_000 });

test('la carga del servidor: salas, jugadores, partidas, CPU, bucle y memoria ahora, y la última hora', async () => {
  mockApi({
    'GET /galaxy/api/admin/rooms': () => jsonResponse(200, { rooms: [] }),
    'GET /galaxy/api/admin/solo/live': () => jsonResponse(200, { runs: [] }),
    'GET /galaxy/api/admin/load': () => jsonResponse(200, load()),
  });
  renderAt('/admin/moderacion/salas', { '/admin/moderacion/salas': <LiveRooms /> });
  const panel = await screen.findByRole('region', { name: L.title });
  const tile = (label: string) => within(panel).getByText(label).closest('.load-tile') as HTMLElement;
  expect(tile(L.tiles.rooms)).toHaveTextContent('5/10');
  expect(tile(L.tiles.players)).toHaveTextContent('12');
  expect(tile(L.tiles.coop)).toHaveTextContent('2');
  expect(tile(L.tiles.coop)).toHaveTextContent(L.coopHint(7));
  expect(tile(L.tiles.solo)).toHaveTextContent('4');
  expect(tile(L.tiles.sockets)).toHaveTextContent('31');
  expect(tile(L.tiles.cpu)).toHaveTextContent('2,1 %');
  expect(tile(L.tiles.loop)).toHaveTextContent('24 ms');
  expect(tile(L.tiles.memory)).toHaveTextContent('210 MB');
  // A line of the last hour, summarised for screen readers.
  expect(within(panel).getByRole('img', { name: L.trend(L.tiles.players, 4, 11, 8) })).toBeInTheDocument();
  // And the whole hour as a table.
  const table = within(panel).getByRole('table', { name: L.table });
  expect(within(table).getAllByRole('row')).toHaveLength(9);
  expect(within(panel).getByText(L.note)).toBeInTheDocument();
});
