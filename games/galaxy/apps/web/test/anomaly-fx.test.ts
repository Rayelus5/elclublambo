import { describe, expect, test } from 'vitest';
import { ANOMALY_LIFE, type AnomalyEvent, type AnomalyMark, drawAnomaly, landingAlpha, splitOffset, SPLIT_S, TEAR_ALPHA } from '../src/arena/stage/anomaly';

// A relic's anomaly drawn as a glitch (the owner: «parece más un bug del juego que algo intencionado»): every outcome
// leaves a mark, small and local, never brighter than the storm's cap, and still with reduced motion.

type Op = { op: string; args: number[]; style?: { alpha?: number; color?: number } };
function pen() {
  const ops: Op[] = [];
  const g = {
    moveTo: (...args: number[]) => (ops.push({ op: 'moveTo', args }), g),
    lineTo: (...args: number[]) => (ops.push({ op: 'lineTo', args }), g),
    rect: (...args: number[]) => (ops.push({ op: 'rect', args }), g),
    circle: (...args: number[]) => (ops.push({ op: 'circle', args }), g),
    stroke: (style: Op['style']) => (ops.push({ op: 'stroke', args: [], style }), g),
    fill: (style: Op['style']) => (ops.push({ op: 'fill', args: [], style }), g),
  };
  return { g: g as never, ops };
}
const event = (what: AnomalyEvent['what'], extra: Partial<AnomalyEvent> = {}): AnomalyEvent => ({
  t: 'anomaly',
  probe: 0,
  what,
  fx: 0,
  fy: 0,
  tx: what === 'blink' ? -70 : 0,
  ty: 0,
  radius: what === 'freeze' ? 110 : 0,
  targets: what === 'strike' ? [60, 0, 0, 70, -40, -40] : [],
  ...extra,
});
const mark = (what: AnomalyEvent['what'], over: Partial<AnomalyMark> = {}): AnomalyMark => ({ e: event(what), at: 0, mine: true, tear: true, seed: 7, ...over });
const shapes = (ops: Op[]) => ops.filter((o) => o.op !== 'stroke' && o.op !== 'fill');

describe('la anomalía se ve', () => {
  test.each(['blink', 'freeze', 'strike'] as const)('%s deja una marca y se va al acabar', (what) => {
    const { g, ops } = pen();
    expect(drawAnomaly(g, mark(what), 0.05, false)).toBe(true);
    expect(ops.length).toBeGreaterThan(4);
    const after = pen();
    expect(drawAnomaly(after.g, mark(what), ANOMALY_LIFE + 0.01, false)).toBe(false);
    expect(after.ops).toHaveLength(0);
  });

  test('la descarga dibuja un rayo hasta cada enemigo golpeado', () => {
    const { g, ops } = pen();
    drawAnomaly(g, mark('strike'), 0.05, false);
    const ends = ops.filter((o) => o.op === 'lineTo').map((o) => o.args.join(','));
    for (const at of ['60,0', '0,70', '-40,-40']) expect(ends).toContain(at);
  });

  test('ningún velo pasa de 0,35 de opacidad (fotosensibilidad)', () => {
    for (const what of ['blink', 'freeze', 'strike'] as const) {
      for (let age = 0; age < ANOMALY_LIFE; age += 0.013) {
        const { g, ops } = pen();
        drawAnomaly(g, mark(what), age, false);
        for (const o of ops.filter((x) => x.op === 'fill')) expect(o.style!.alpha!).toBeLessThanOrEqual(TEAR_ALPHA);
      }
    }
  });

  test('solo rasga el campo cuando le toca (la mía, con pausa entre rasgaduras)', () => {
    const torn = pen();
    drawAnomaly(torn.g, mark('blink'), 0.1, false);
    const calm = pen();
    drawAnomaly(calm.g, mark('blink', { tear: false }), 0.1, false);
    expect(torn.ops.filter((o) => o.op === 'rect').length).toBeGreaterThan(0);
    expect(calm.ops.filter((o) => o.op === 'rect')).toHaveLength(0);
  });

  test('salta a pasos: cambia entre pasos y no dentro de uno', () => {
    const at = (age: number) => {
      const { g, ops } = pen();
      drawAnomaly(g, mark('strike'), age, false);
      // The bolts' bends (the ring where it hit grows smoothly).
      return JSON.stringify(ops.filter((o) => o.op === 'lineTo'));
    };
    expect(at(0.051)).toBe(at(0.099));
    expect(at(0.051)).not.toBe(at(0.151));
  });

  test('con movimiento reducido no tiembla ni rasga: un contorno quieto que se apaga', () => {
    for (const what of ['blink', 'freeze', 'strike'] as const) {
      const a = pen();
      drawAnomaly(a.g, mark(what), 0.02, true);
      const b = pen();
      drawAnomaly(b.g, mark(what), 0.3, true);
      expect(JSON.stringify(shapes(a.ops))).toBe(JSON.stringify(shapes(b.ops)));
      expect(a.ops.filter((o) => o.op === 'rect')).toHaveLength(0);
    }
    expect(landingAlpha(0.05, true)).toBe(1);
    expect(splitOffset(mark('blink'), 0.05, true)).toBe(0);
  });

  test('la sonda lanzada aparece en escalones y sus copias se juntan', () => {
    const seen = new Set<number>();
    for (let age = 0; age < SPLIT_S; age += 0.01) seen.add(landingAlpha(age, false));
    expect(seen.size).toBeGreaterThan(2);
    expect(landingAlpha(SPLIT_S, false)).toBe(1);
    expect(splitOffset(mark('blink'), 0.01, false)).toBeGreaterThan(1);
    expect(splitOffset(mark('blink'), SPLIT_S, false)).toBe(0);
  });
});
