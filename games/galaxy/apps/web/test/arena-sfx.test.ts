import type { SimEvent } from '@galaxy/sim';
import { beforeEach, expect, test, vi } from 'vitest';
import { fakeContext } from './fake-audio';

// The arena's sounds through a silent WebAudio context: a relic's anomaly is heard (it once went off in silence and
// looked like a bug), only on its owner's screen.
const ctx = fakeContext();
vi.mock('../src/audio/mixer', () => ({ sfxOut: () => ({ ctx, out: ctx.createGain() }) }));
const { playEvents } = await import('../src/arena/arena-sfx');

const anomaly = (probe: number, what: 'blink' | 'freeze' | 'strike'): SimEvent => ({ t: 'anomaly', probe, what, fx: 0, fy: 0, tx: 0, ty: 0, radius: 0, targets: [] });

beforeEach(() => {
  ctx.started.length = 0;
  (ctx as unknown as { currentTime: number }).currentTime += 10;
});

test('la anomalía suena: un chasquido de estática y dos pasos que bajan', () => {
  playEvents([anomaly(0, 'blink')], 0);
  expect(ctx.started.filter((s) => s.kind === 'buffer').length).toBeGreaterThanOrEqual(3);
  expect(ctx.started.filter((s) => s.kind === 'osc').length).toBeGreaterThanOrEqual(2);
});

test('la de un compañero no suena en mi pantalla', () => {
  playEvents([anomaly(1, 'strike')], 0);
  expect(ctx.started).toHaveLength(0);
});

// The volatile elite (the owner, 2026-11-14: «no hay ninguna animación … ni sonido ni nada al explotar»): its fuse beeps
// faster and faster, and the blast is a deep thump with a crack of debris.
test('la mecha de una explosión pita cada vez más rápido y el estallido suena grave', () => {
  playEvents([{ t: 'telegraph', kind: 'explode', x: 0, y: 0, angle: 0, ticks: 72, radius: 50 }], 0);
  const beeps = ctx.started.filter((s) => s.kind === 'osc');
  expect(beeps).toHaveLength(5);
  ctx.started.length = 0;
  playEvents([{ t: 'blast', x: 0, y: 0, radius: 50 }], 0);
  expect(ctx.started.filter((s) => s.kind === 'osc').length).toBe(2);
  expect(ctx.started.filter((s) => s.kind === 'buffer').length).toBe(1);
});

test('otros avisos no pitan', () => {
  playEvents([{ t: 'telegraph', kind: 'charge', x: 0, y: 0, angle: 0, ticks: 40, radius: 160 }], 0);
  expect(ctx.started).toHaveLength(0);
});
