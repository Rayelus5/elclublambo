import { decodeLog, fromBase64, stateHash } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { checkReplay, createPlayback, replayOptionsOf, replayUntil } from '../src/admin/replay/playback';
import { playedRun } from './replay-fixture';

// The panel's replayer (GDD §16.2, §16.6; M6d-3): a recorded run played forwards, sought backwards (rebuilt from tick
// 0), stopped at its last tick, and compared with what the server kept.

const run = playedRun(900);
const log = () => decodeLog(fromBase64(run.inputs!));
const fresh = () => createPlayback(replayOptionsOf(run.start), log(), run.run.ticks!);

test('avanzar y volver atrás llegan al mismo estado', () => {
  const straight = fresh();
  straight.advance(600);
  expect(straight.tick).toBe(600);
  const back = fresh();
  back.advance(850);
  back.seek(600);
  expect(back.tick).toBe(600);
  expect(stateHash(back.sim)).toBe(stateHash(straight.sim));
});

test('cada paso del avance pasa sus eventos, y saltar no los pasa', () => {
  const p = fresh();
  let steps = 0;
  p.advance(120, () => steps++);
  expect(steps).toBeGreaterThanOrEqual(120);
  let skipped = 0;
  p.seek(400);
  p.advance(0, () => skipped++);
  expect(skipped).toBe(0);
  expect(p.tick).toBe(400);
});

test('se para en el último tick', () => {
  const p = fresh();
  p.advance(5000);
  expect(p.tick).toBe(run.run.ticks);
  expect(p.ended).toBe(true);
  p.seek(10);
  expect(p.ended).toBe(false);
});

test('checkReplay dice qué coincide y qué no', () => {
  const p = fresh();
  p.advance(Number.MAX_SAFE_INTEGER);
  const ok = checkReplay(p.sim, run.run);
  expect(ok.matches).toBe(true);
  expect(ok.rows.map((r) => r.key)).toEqual(['hash', 'ticks', 'kills', 'depth', 'level']);
  expect(ok.rows.every((r) => r.same)).toBe(true);
  // A hash that holds but a figure the client inflated is not the same run either.
  const bad = checkReplay(p.sim, { ...run.run, hash: '0000000000000000', claimed: { ...run.run.claimed!, kills: run.run.claimed!.kills + 1 } });
  expect(bad.matches).toBe(false);
  expect(bad.rows.filter((r) => !r.same).map((r) => r.key)).toEqual(['hash', 'kills']);
});

test('una partida que el servidor recortó se repite y se compara con lo que envió', () => {
  // The server keeps the claim clipped to real time (fewer ticks and kills) but the hash as sent.
  const clipped = { ...run.run, ticks: 300, kills: 0 };
  expect(replayUntil(clipped)).toBe(run.run.ticks);
  const p = createPlayback(replayOptionsOf(run.start), log(), replayUntil(clipped));
  p.advance(Number.MAX_SAFE_INTEGER);
  const c = checkReplay(p.sim, clipped);
  expect(c.matches).toBe(true);
  expect(c.rows.find((r) => r.key === 'ticks')!.saved).toBe(run.run.ticks);
  // Without what it sent (runs finished before M6d-3), the kept figures are all there is.
  expect(replayUntil({ ...clipped, claimed: null })).toBe(300);
});
