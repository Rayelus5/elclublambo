import { type CoopRunStart, type CoopServerMessage, coopRulesOf, parseConfig } from '@galaxy/shared';
import { DEFAULT_CONTENT, encodeLog, gainXp, type Sim, toBase64 } from '@galaxy/sim';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CoopArena } from '../src/coop/CoopArena';
import { copy } from '../src/copy/es';

// A co-op run in the browser (multiplayer plan, phase 6): the play socket's hello builds the run, the world advances
// only up to the tick the server closed, my input goes out only when it changes, the cards are picked with a number
// key without pausing, and a run that is gone says so. The PixiJS stage is replaced (jsdom has no WebGL).

const stageFollow = vi.hoisted(() => vi.fn());
vi.mock('../src/arena/stage/stage', () => ({
  TEAM_TINT: [0xffc94a, 0x45e3a6, 0xbfe3ff, 0xff6b7a],
  createStage: vi.fn(async () => ({
    app: {},
    render: vi.fn(),
    feed: vi.fn(),
    resize: vi.fn(),
    camera: () => ({ zoom: 2, worldW: 640, worldH: 360, bars: 0, x: 0, y: 0 }),
    destroy: vi.fn(),
    follow: stageFollow,
  })),
}));

const t = copy.coop.arena;
const RUN = '00000000-0000-4000-8000-0000000000c1';
const start: CoopRunStart = {
  id: RUN,
  seed: '424242',
  sector: 'outer-nebula',
  anomaly: null,
  content: DEFAULT_CONTENT,
  contentVersion: 0,
  rules: coopRulesOf(parseConfig('coop', {})),
  players: [
    { username: 'sonda_rayo', probe: 'lumen', relics: [], bonuses: [], variant: null },
    { username: 'vega', probe: 'lumen', relics: [], bonuses: [], variant: null },
  ],
  slot: 0,
  startedAt: '2026-11-09T10:00:00.000Z',
};

class FakeSocket {
  static last: FakeSocket | null = null;
  static OPEN = 1;
  readyState = 1;
  sent: unknown[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  push(msg: CoopServerMessage) {
    act(() => this.onmessage?.({ data: JSON.stringify(msg) }));
  }
}

function manualClock() {
  let now = 0;
  let queued: ((n: number) => void)[] = [];
  return {
    now: () => now,
    schedule: (cb: (n: number) => void) => {
      queued.push(cb);
    },
    frames(n: number) {
      for (let i = 0; i < n; i++) {
        now += 1000 / 60;
        const q = queued;
        queued = [];
        act(() => q.forEach((cb) => cb(now)));
      }
    },
  };
}

beforeEach(() => {
  FakeSocket.last = null;
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => vi.unstubAllGlobals());

async function mount() {
  const clock = manualClock();
  let sim: Sim | null = null;
  render(<CoopArena runId={RUN} onExit={() => {}} onAbandon={() => {}} clock={clock} onSim={(s) => (sim = s)} />);
  await waitFor(() => expect(FakeSocket.last).not.toBeNull());
  const ws = FakeSocket.last!;
  expect(ws.url).toContain(`/galaxy/api/coop/play/ws?run=${RUN}`);
  ws.push({ t: 'hello', start, log: toBase64(encodeLog({ probes: 2, events: [] })), to: 0 });
  await waitFor(() => expect(sim).not.toBeNull());
  // The stage loads asynchronously; the loop starts once it is ready.
  await act(async () => {});
  return { clock, ws, sim: () => sim! };
}

test('el saludo arma la partida con el equipo, y el mundo solo avanza hasta el tick cerrado', async () => {
  const { clock, ws, sim } = await mount();
  expect(screen.getByRole('complementary', { name: t.team })).toHaveTextContent('vega');
  expect(screen.getByRole('complementary', { name: t.team })).toHaveTextContent(t.you);
  clock.frames(30);
  expect(sim().tick).toBe(0);
  ws.push({ t: 'f', to: 40, ev: [5, 1, 0, 127, 0, -1] });
  clock.frames(120);
  expect(sim().tick).toBe(40);
  // Probe 1 moved right from tick 5, as the server sealed it.
  expect(sim().probes[1]!.x).toBeGreaterThan(sim().probes[0]!.x + 20);
});

test('mi entrada sale solo cuando cambia', async () => {
  const { clock, ws } = await mount();
  ws.push({ t: 'f', to: 100, ev: [] });
  clock.frames(3);
  const inputs = () => ws.sent.filter((m) => (m as { t: string }).t === 'in');
  const before = inputs().length;
  fireEvent.keyDown(window, { code: 'KeyD' });
  clock.frames(5);
  expect(inputs().slice(before)).toEqual([{ t: 'in', mx: 127, my: 0, aim: -1 }]);
  fireEvent.keyUp(window, { code: 'KeyD' });
  clock.frames(2);
  expect(inputs().at(-1)).toEqual({ t: 'in', mx: 0, my: 0, aim: -1 });
});

test('las cartas salen sin pausar y se eligen con su número, nombrando la oferta', async () => {
  const { clock, ws, sim } = await mount();
  ws.push({ t: 'f', to: 600, ev: [] });
  clock.frames(2);
  act(() => gainXp(sim(), sim().probes[0]!, sim().probes[0]!.xpNext));
  clock.frames(4);
  const strip = await screen.findByRole('region', { name: t.cards }, { timeout: 2000 });
  expect(strip).toBeInTheDocument();
  expect(sim().status).toBe('running');
  // The cards listen to the number keys from an effect that runs just after they show: let it run before pressing
  // (a loaded CI machine pressed in between).
  await act(async () => {});
  fireEvent.keyDown(window, { key: '2', code: 'Digit2' });
  expect(ws.sent).toContainEqual({ t: 'pick', i: 1, seq: sim().probes[0]!.offerSeq & 255 });
  await waitFor(() => expect(screen.queryByRole('region', { name: t.cards })).not.toBeInTheDocument());
});

describe('avisos rápidos', () => {
  const m = copy.coop.marks;
  const sentMarks = (ws: FakeSocket) => ws.sent.filter((x) => (x as { t: string }).t === 'mark');

  test('un toque de Q avisa «Aquí» donde apunto', async () => {
    const { clock, ws } = await mount();
    ws.push({ t: 'f', to: 100, ev: [] });
    clock.frames(3);
    fireEvent.mouseMove(window, { clientX: 700, clientY: 300 });
    fireEvent.keyDown(window, { code: 'KeyQ' });
    fireEvent.keyUp(window, { code: 'KeyQ' });
    expect(sentMarks(ws)).toEqual([{ t: 'mark', kind: 'here', x: expect.any(Number), y: expect.any(Number) }]);
  });

  test('con Q pulsada sale la rueda; hacia arriba y soltar es «Ayuda»', async () => {
    const { clock, ws } = await mount();
    ws.push({ t: 'f', to: 100, ev: [] });
    clock.frames(3);
    fireEvent.mouseMove(window, { clientX: 700, clientY: 300 });
    fireEvent.keyDown(window, { code: 'KeyQ' });
    expect(screen.getByRole('menu', { name: m.wheel })).toBeInTheDocument();
    fireEvent.mouseMove(window, { clientX: 700, clientY: 220 });
    fireEvent.keyUp(window, { code: 'KeyQ' });
    expect(sentMarks(ws)).toEqual([expect.objectContaining({ kind: 'help' })]);
    expect(screen.queryByRole('menu', { name: m.wheel })).not.toBeInTheDocument();
  });

  test('el aviso de un compañero se ve con su nombre', async () => {
    const { ws } = await mount();
    ws.push({ t: 'mark', slot: 1, kind: 'danger', x: 40, y: 0 });
    expect(await screen.findByRole('img', { name: m.label('vega', m.kinds.danger) })).toBeInTheDocument();
  });
});

test('fuera hasta la siguiente capa, la cámara sigue a un compañero en pie (fase 6c), y vuelve al volver', async () => {
  const { clock, ws, sim } = await mount();
  ws.push({ t: 'f', to: 200, ev: [] });
  clock.frames(3);
  stageFollow.mockClear();
  act(() => {
    sim().probes[0]!.life = 'out';
  });
  clock.frames(3);
  expect(await screen.findByText(t.watching('vega'))).toBeInTheDocument();
  expect(stageFollow).toHaveBeenLastCalledWith(1);
  act(() => {
    sim().probes[0]!.life = 'up';
  });
  clock.frames(3);
  await waitFor(() => expect(screen.queryByText(t.watching('vega'))).not.toBeInTheDocument());
  expect(stageFollow).toHaveBeenLastCalledWith(0);
});

test('cada 5 s manda la huella de su mundo y, si el árbitro dice que no coincide, se reconstruye desde el registro', async () => {
  const { clock, ws, sim } = await mount();
  ws.push({ t: 'f', to: 400, ev: [3, 1, 0, 127, 0, -1] });
  clock.frames(40);
  expect(sim().tick).toBe(400);
  const sums = ws.sent.filter((m) => (m as { t: string }).t === 'sum');
  expect(sums).toEqual([{ t: 'sum', tick: 300, h: expect.stringMatching(/^[0-9a-f]+$/) }]);
  const before = sim();
  const x = before.probes[1]!.x;
  ws.push({ t: 'desync', tick: 300 });
  // A fresh world from the start and the whole sealed log, caught up to where it was.
  await waitFor(() => expect(sim()).not.toBe(before));
  clock.frames(40);
  expect(sim().tick).toBe(400);
  expect(sim().probes[1]!.x).toBe(x);
});

test('un admin mira en directo: su socket es el de mirar, no manda nada, cambia de cámara y al acabar ve al equipo (fase 7)', async () => {
  const clock = manualClock();
  let sim: Sim | null = null;
  const exit = vi.fn();
  render(<CoopArena runId={RUN} viewer onExit={exit} onAbandon={() => {}} clock={clock} onSim={(s) => (sim = s)} />);
  await waitFor(() => expect(FakeSocket.last).not.toBeNull());
  const ws = FakeSocket.last!;
  expect(ws.url).toContain(`/galaxy/api/admin/coop/watch/ws?run=${RUN}`);
  ws.push({ t: 'hello', start, log: toBase64(encodeLog({ probes: 2, events: [] })), to: 0 });
  await waitFor(() => expect(sim).not.toBeNull());
  await act(async () => {});
  ws.push({ t: 'f', to: 400, ev: [] });
  // Keys do nothing and nothing is ever sent (no input, no hash, no menu).
  fireEvent.keyDown(window, { code: 'KeyD' });
  fireEvent.keyDown(window, { code: 'Escape' });
  clock.frames(40);
  expect(ws.sent).toEqual([]);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const cams = screen.getByRole('radiogroup', { name: t.camera });
  stageFollow.mockClear();
  fireEvent.click(within(cams).getByRole('radio', { name: 'vega' }));
  expect(within(cams).getByRole('radio', { name: 'vega' })).toHaveAttribute('aria-checked', 'true');
  expect(stageFollow).toHaveBeenLastCalledWith(1);
  // The end: the group's table, and back to the rooms.
  ws.push({ t: 'end', outcome: 'died', result: null });
  ws.push({ t: 'f', to: 500, ev: [] });
  act(() => {
    sim!.status = 'dead';
  });
  clock.frames(3);
  expect(await screen.findByText(t.watchEnded, {}, { timeout: 4000 })).toBeInTheDocument();
  expect(screen.getByRole('table', { name: copy.coop.results.title })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: t.watchBack }));
  expect(exit).toHaveBeenCalled();
});

test('una partida que ya no está lo dice y deja volver a la sala', async () => {
  const onExit = vi.fn();
  render(<CoopArena runId={RUN} onExit={onExit} onAbandon={() => {}} />);
  await waitFor(() => expect(FakeSocket.last).not.toBeNull());
  act(() => FakeSocket.last!.onclose?.({ code: 4404 }));
  fireEvent.click(await screen.findByRole('button', { name: t.back }));
  expect(onExit).toHaveBeenCalledOnce();
});
