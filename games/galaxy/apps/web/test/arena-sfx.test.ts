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
