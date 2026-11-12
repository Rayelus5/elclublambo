import type { AdminRunReplay, RoomView, SoloLiveList, SoloWatchMessage } from '@galaxy/shared';
import { act, screen, within } from '@testing-library/react';
import { DEFAULT_CONTENT, encodeLog, toBase64 } from '@galaxy/sim';
import { afterEach, expect, test, vi } from 'vitest';
import { LiveRooms } from '../src/admin/LiveRooms';
import { SoloWatchScreen, type WatchSocket } from '../src/admin/SoloWatchScreen';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// Watching a solo run live from the panel (plan «escáner pro», part G): «Salas en vivo» lists the solo runs being
// played, each leading to its live view; the view says, as it goes, whether it is connecting, catching up, waiting for a
// pick, paused, without the player, over, or gone. The PixiJS stage is replaced: jsdom has no WebGL.

vi.mock('../src/arena/stage/stage', () => ({
  createStage: vi.fn(async () => ({
    app: {},
    render: vi.fn(),
    feed: vi.fn(),
    resize: vi.fn(),
    follow: vi.fn(),
    setReduced: vi.fn(),
    setColorVision: vi.fn(),
    camera: () => ({ zoom: 2, worldW: 640, worldH: 360, bars: 0, x: 0, y: 0 }),
    destroy: vi.fn(),
  })),
}));
afterEach(() => vi.unstubAllGlobals());

const s = copy.admin.moderation.solo;
const RUN = '00000000-0000-4000-8000-0000000000a1';

class Sock implements WatchSocket {
  static last: Sock | null = null;
  readyState = 1;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    Sock.last = this;
  }
  close() {
    this.readyState = 3;
  }
  push(m: SoloWatchMessage) {
    act(() => this.onmessage?.({ data: JSON.stringify(m) }));
  }
  drop(code: number) {
    act(() => this.onclose?.({ code }));
  }
}

const start: AdminRunReplay['start'] = { seed: '7', sector: 'outer-nebula', probe: 'lumen', relics: [], bonuses: [], variant: null, anomaly: null, content: DEFAULT_CONTENT };
const hello = (s: 'run' | 'pause' = 'run'): SoloWatchMessage => ({
  t: 'hello',
  run: { id: RUN, player: 'vega', startedAt: '2026-11-12T10:00:00.000Z' },
  start,
  contentFallback: false,
  log: toBase64(encodeLog({ probes: 1, events: [] })),
  to: 0,
  s,
});
const watch = () => {
  mockApi({});
  renderAt(`/admin/moderacion/directo/solo/${RUN}`, { '/admin/moderacion/directo/solo/:runId': <SoloWatchScreen open={(url) => new Sock(url)} /> });
  return Sock.last!;
};

test('abre el directo de la partida, dice de quién es y cómo va', async () => {
  const sock = watch();
  expect(sock.url).toMatch(new RegExp(`/galaxy/api/admin/solo/watch/ws\\?run=${RUN}$`));
  expect(screen.getByRole('status')).toHaveTextContent(s.connecting);
  sock.push(hello());
  expect(await screen.findByRole('heading', { level: 1, name: s.title('vega') })).toBeInTheDocument();
  expect(screen.getByText(DEFAULT_CONTENT.sectors.find((x) => x.id === 'outer-nebula')!.name, { exact: false })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: s.back })).toHaveAttribute('href', '/admin/moderacion/salas');
  sock.push({ t: 'st', s: 'pause' });
  expect(screen.getByRole('status')).toHaveTextContent(s.paused);
  sock.push({ t: 'st', s: 'lost' });
  expect(screen.getByRole('status')).toHaveTextContent(s.lost);
  sock.push({ t: 'st', s: 'done' });
  expect(screen.getByRole('status')).toHaveTextContent(s.saving);
  sock.push({ t: 'end' });
  expect(screen.getByRole('status')).toHaveTextContent(s.ended);
  sock.drop(1000);
  expect(screen.getByRole('status')).toHaveTextContent(s.ended);
});

test('una partida que ya no está en directo lo dice; un corte también', async () => {
  watch().drop(4404);
  expect(screen.getByRole('status')).toHaveTextContent(s.gone);
  expect(screen.getByRole('link', { name: s.back })).toBeInTheDocument();
});

test('un hola que no se lee lo dice en vez de quedarse conectando', () => {
  const sock = watch();
  sock.push({ ...(hello() as Extract<SoloWatchMessage, { t: 'hello' }>), log: 'AAAA' });
  expect(screen.getByRole('status')).toHaveTextContent(s.broken);
});

test('si el directo se corta a medias lo dice', async () => {
  const sock = watch();
  sock.push(hello());
  await screen.findByRole('heading', { level: 1 });
  sock.drop(1006);
  expect(screen.getByRole('status')).toHaveTextContent(s.closed);
});

const room = (): RoomView & { idleSeconds: number } => ({
  id: '00000000-0000-4000-8000-0000000000e1',
  code: 'ABC234',
  kind: 'private',
  sector: 'outer-nebula',
  leader: 'vega',
  state: 'lobby',
  members: [{ username: 'vega', level: 3, probe: 'lumen', skin: null, ready: true, connected: true, leader: true }],
  max: 4,
  createdAt: '2026-11-09T10:00:00Z',
  canStart: false,
  run: null,
  idleSeconds: 12,
});

test('Salas en vivo lista las incursiones en solitario y lleva a cada directo', async () => {
  const solo: SoloLiveList = {
    runs: [
      { runId: RUN, player: 'lyra', sector: 'outer-nebula', probe: 'lumen', startedAt: '2026-11-12T10:00:00.000Z', tick: 3 * 60 * 60 + 30 * 60, state: 'pick', watchers: 1 },
      { runId: '00000000-0000-4000-8000-0000000000a2', player: 'orion', sector: 'outer-nebula', probe: 'lumen', startedAt: '2026-11-12T09:00:00.000Z', tick: 600, state: 'lost', watchers: 0 },
    ],
  };
  mockApi({ 'GET /galaxy/api/admin/rooms': () => jsonResponse(200, { rooms: [room()] }), 'GET /galaxy/api/admin/solo/live': () => jsonResponse(200, solo) });
  renderAt('/admin/moderacion/salas', { '/admin/moderacion/salas': <LiveRooms /> });
  const table = await screen.findByRole('table', { name: s.tableTitle });
  expect(within(table).getByRole('link', { name: s.watchOf('lyra') })).toHaveAttribute('href', `/admin/moderacion/directo/solo/${RUN}`);
  expect(within(table).getByText('3:30')).toBeInTheDocument();
  expect(within(table).getByText(s.states['pick']!)).toBeInTheDocument();
  expect(within(table).getByText(s.states['lost']!)).toBeInTheDocument();
});

test('sin nadie jugando en solitario lo dice', async () => {
  mockApi({ 'GET /galaxy/api/admin/rooms': () => jsonResponse(200, { rooms: [] }), 'GET /galaxy/api/admin/solo/live': () => jsonResponse(200, { runs: [] }) });
  renderAt('/admin/moderacion/salas', { '/admin/moderacion/salas': <LiveRooms /> });
  expect(await screen.findByText(s.none)).toBeInTheDocument();
});
