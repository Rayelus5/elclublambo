import { coopRulesOf, parseConfig } from '@galaxy/shared';
import { DEFAULT_CONTENT, MOVE, PRESENCE } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { ALL_GONE_MS, AWAY_AFTER_MS, CoopRun, MARK_GAP_MS, TICK_MS } from '../../src/coop/relay';

// The relay's clock and presence (multiplayer plan, phase 6, review): with nobody connected the clock waits (a shared
// outage never kills the run), «away» is only for one who is missing while others play, everyone gone for long ends
// the run, a player whose last socket closes stops moving, and one who leaves keeps only the Cores killed until then.

const T0 = 1_000_000;
function run(n = 2) {
  const players = Array.from({ length: n }, (_, i) => ({ username: `p${i}`, probe: 'lumen', relics: [], bonuses: [], variant: null }));
  const base = {
    id: 'r',
    seed: '424242',
    sector: 'outer-nebula',
    anomaly: null,
    content: DEFAULT_CONTENT,
    contentVersion: 0,
    rules: coopRulesOf(parseConfig('coop', {})),
    players,
    startedAt: new Date(T0).toISOString(),
  };
  const slots = players.map((p, i) => ({ accountId: `a${i}`, username: p.username, runRowId: `row${i}` }));
  return new CoopRun('r', 'room', base, slots, T0);
}
const socket = () => ({ readyState: 1, sent: [] as string[], send(d: string) { this.sent.push(d); }, close() {} });
const kinds = (r: CoopRun, kind: number) => {
  const out: number[][] = [];
  for (let i = 0; i + 5 < r.events.length; i += 6) if (r.events[i + 2] === kind) out.push(r.events.slice(i, i + 6));
  return out;
};
/** Pumps every 16 ms from `from` to `to`. */
function pumpRange(r: CoopRun, from: number, to: number): number {
  let t = from;
  for (; t <= to; t += 16) if (r.pump(t)) break;
  return t;
}

test('sin nadie conectado el reloj espera; al llegar el primero, empieza', () => {
  const r = run();
  pumpRange(r, T0, T0 + 5000);
  expect(r.closed).toBe(0);
  r.attach(0, socket());
  const t = T0 + 5000;
  pumpRange(r, t, t + 1000);
  expect(r.closed).toBeGreaterThanOrEqual(55);
  expect(r.closed).toBeLessThanOrEqual(62);
});

test('si se caen todos a la vez, nadie queda ausente ni la partida acaba, y sigue al volver', () => {
  const r = run();
  const [a, b] = [socket(), socket()];
  r.attach(0, a);
  r.attach(1, b);
  let t = pumpRange(r, T0, T0 + 2000);
  const closed = r.closed;
  r.detach(0, a, t);
  r.detach(1, b, t);
  t = pumpRange(r, t, t + AWAY_AFTER_MS + 5000);
  expect(r.closed - closed).toBeLessThanOrEqual(1);
  expect(kinds(r, PRESENCE)).toEqual([]);
  expect(r.ended).toBe(false);
  r.attach(0, socket());
  r.attach(1, socket());
  pumpRange(r, t, t + 1000);
  expect(r.closed - closed).toBeGreaterThan(50);
  expect(r.referee.status).toBe('running');
});

test('quien falta mientras otro juega queda ausente a los 10 s, y vuelve al reconectar', () => {
  const r = run();
  const a = socket();
  r.attach(0, a);
  r.attach(1, socket());
  let t = pumpRange(r, T0, T0 + 1000);
  r.detach(0, a, t);
  t = pumpRange(r, t, t + AWAY_AFTER_MS + 200);
  expect(kinds(r, PRESENCE).map((e) => [e[1], e[3]])).toEqual([[0, 1]]);
  r.attach(0, socket());
  pumpRange(r, t, t + 200);
  expect(kinds(r, PRESENCE).map((e) => [e[1], e[3]])).toEqual([
    [0, 1],
    [0, 0],
  ]);
});

test('sin nadie durante mucho tiempo, se van todos y la partida acaba', () => {
  const r = run();
  const a = socket();
  r.attach(0, a);
  let t = pumpRange(r, T0, T0 + 1000);
  r.detach(0, a, t);
  t = pumpRange(r, t, t + ALL_GONE_MS + 2000);
  expect(r.ended).toBe(true);
  expect(r.referee.status).toBe('dead');
  expect(kinds(r, PRESENCE).every((e) => e[3] === 2)).toBe(true);
});

test('al cerrarse su último socket, la sonda deja de moverse', () => {
  const r = run();
  const a = socket();
  r.attach(0, a);
  r.attach(1, socket());
  let t = pumpRange(r, T0, T0 + 200);
  r.input(0, 127, 0, -1);
  t = pumpRange(r, t, t + 200);
  r.detach(0, a, t);
  pumpRange(r, t, t + 200);
  expect(kinds(r, MOVE).map((e) => [e[1], e[3], e[4]])).toEqual([
    [0, 127, 0],
    [0, 0, 0],
  ]);
});

test('quien se va guarda los Núcleos de hasta entonces, no los de después', () => {
  const r = run();
  r.attach(0, socket());
  r.attach(1, socket());
  let t = pumpRange(r, T0, T0 + 200);
  r.referee.bossKills = 2;
  r.leave(1);
  t = pumpRange(r, t, t + 100);
  r.referee.bossKills = 5;
  expect(r.gone[1]).toMatchObject({ bossKills: 2 });
  void t;
  void TICK_MS;
});

test('si se van todos (aunque nadie esté conectado), la partida acaba enseguida', () => {
  const r = run();
  r.leave(0);
  r.leave(1);
  pumpRange(r, T0, T0 + 500);
  expect(r.ended).toBe(true);
});

test('un aviso rápido llega a todo el grupo con quién lo puso, no se repite sin pausa y quien se fue ya no avisa', () => {
  const r = run();
  const a = socket();
  const b = socket();
  r.attach(0, a);
  r.attach(1, b);
  const marks = (s: ReturnType<typeof socket>) => s.sent.map((d) => JSON.parse(d) as { t: string }).filter((m) => m.t === 'mark');
  r.mark(0, 'help', 120, -40, T0 + 100);
  expect(marks(b)).toEqual([{ t: 'mark', slot: 0, kind: 'help', x: 120, y: -40 }]);
  expect(marks(a)).toHaveLength(1);
  // Too soon after the last one: dropped (a held key never floods the group).
  r.mark(0, 'here', 0, 0, T0 + 100 + MARK_GAP_MS - 1);
  expect(marks(b)).toHaveLength(1);
  r.mark(0, 'danger', 5, 5, T0 + 100 + MARK_GAP_MS);
  expect(marks(b)).toHaveLength(2);
  // Marks never enter the sealed log: the world stays the same.
  expect(r.events).toEqual([]);
  r.leave(0);
  r.mark(0, 'here', 0, 0, T0 + 10_000);
  expect(marks(b)).toHaveLength(2);
});
