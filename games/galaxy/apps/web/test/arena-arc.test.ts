import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, vi } from 'vitest';

vi.mock('pixi.js/unsafe-eval', () => ({}));
const { arcFrom } = await import('../src/arena/stage/stage');

// Open arcs in the arena (the gravity well's spinning arcs, the beacon's progress, an armoured front): each one starts
// with the pen at its own first point. Drawn straight after another shape, PixiJS used to join them with a line that
// crossed the whole arena (reported 2026-11-09).

test('arcFrom mueve el lápiz al inicio del arco antes de dibujarlo', () => {
  const calls: string[] = [];
  const g = {
    moveTo(x: number, y: number) {
      calls.push(`moveTo ${x.toFixed(2)} ${y.toFixed(2)}`);
      return this;
    },
    arc(x: number, y: number, r: number, a: number, b: number) {
      calls.push(`arc ${x} ${y} ${r} ${a.toFixed(2)} ${b.toFixed(2)}`);
      return this;
    },
  };
  arcFrom(g as never, 100, 50, 10, Math.PI / 2, Math.PI);
  expect(calls).toEqual(['moveTo 100.00 60.00', 'arc 100 50 10 1.57 3.14']);
});

test('ningún arco abierto del escenario se dibuja sin arcFrom', () => {
  // Tests run from the workspace root (vitest.config.ts).
  const src = readFileSync(resolve(process.cwd(), 'apps/web/src/arena/stage/stage.ts'), 'utf8');
  // Every `.arc(` is either inside arcFrom or a pie slice that starts with moveTo(x, y) at its centre.
  const bare = src.split('\n').filter((l) => l.includes('.arc(') && !/moveTo\(x, y\)\.arc\(|moveTo\(x \+ Math\.cos\(from\)/.test(l));
  expect(bare).toEqual([]);
});
