import { type CoopRunStart, type CoopServerMessage, coopRulesOf, parseConfig } from '@galaxy/shared';
import { DEFAULT_CONTENT, encodeLog, gainXp, type Sim, toBase64 } from '@galaxy/sim';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CoopArena } from '../src/coop/CoopArena';
import { copy } from '../src/copy/es';

// A co-op run in the browser (multiplayer plan, phase 6): the play socket's hello builds the run, the world advances
// only up to the tick the server closed, my input goes out only when it changes, the cards are picked with a number
// key without pausing, and a run that is gone says so. The PixiJS stage is replaced (jsdom has no WebGL).

vi.mock('../src/arena/stage/stage', () => ({
  TEAM_TINT: [0xffc94a, 0x45e3a6, 0xbfe3ff, 0xff6b7a],
  createStage: vi.fn(async () => ({
    app: {},
    render: vi.fn(),
    feed: vi.fn(),
    resize: vi.fn(),
    camera: () => ({ zoom: 2, worldW: 640, worldH: 360, bars: 0, x: 0, y: 0 }),
    destroy: vi.fn(),
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
  fireEvent.keyDown(window, { key: '2', code: 'Digit2' });
  expect(ws.sent).toContainEqual({ t: 'pick', i: 1, seq: sim().probes[0]!.offerSeq & 255 });
  await waitFor(() => expect(screen.queryByRole('region', { name: t.cards })).not.toBeInTheDocument());
});

test('una partida que ya no está lo dice y deja volver a la sala', async () => {
  const onExit = vi.fn();
  render(<CoopArena runId={RUN} onExit={onExit} onAbandon={() => {}} />);
  await waitFor(() => expect(FakeSocket.last).not.toBeNull());
  act(() => FakeSocket.last!.onclose?.({ code: 4404 }));
  fireEvent.click(await screen.findByRole('button', { name: t.back }));
  expect(onExit).toHaveBeenCalledOnce();
});
