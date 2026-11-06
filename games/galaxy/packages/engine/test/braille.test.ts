import { describe, expect, test } from 'vitest';
import { drawTraits, renderBraille, renderFromSeed, subRng, tokenSeed, toText } from '../src/index';
import { LODS, loadCases, lodOf } from './golden';

// ENGINE_PORT §1.2 and §6: the whole braille render of every case without a phenomenon, character for character,
// in the three LODs, plus the colour and radius of the sample dots (what compose and the shader receive).
const plain = loadCases().filter((c) => c.traits.phenomenon === 'none');

function diff(actual: string, expected: string): string | null {
  if (actual === expected) return null;
  const a = actual.split('\n');
  const b = expected.split('\n');
  let cells = 0;
  let first = '';
  for (let r = 0; r < Math.max(a.length, b.length); r++) {
    const ra = [...(a[r] ?? '')];
    const rb = [...(b[r] ?? '')];
    for (let col = 0; col < Math.max(ra.length, rb.length); col++) {
      if (ra[col] !== rb[col]) {
        cells++;
        if (!first) first = `row ${r}, column ${col}: ${ra[col]} vs ${rb[col]}`;
      }
    }
  }
  return `${cells} cells differ (lines ${a.length} vs ${b.length}); first at ${first}`;
}

const count = (on: Uint8Array) => on.reduce((s, x) => s + x, 0);

describe.each(plain.map((c) => [c.name, c] as const))('%s', (_, c) => {
  test.each(LODS)('braille idéntico en %i columnas', (columns) => {
    const lod = lodOf(c, columns);
    const r = renderBraille(c.traits, BigInt(c.seed), { columns });
    expect(diff(r.text, lod.braille)).toBeNull();
    expect([r.nx, r.ny]).toEqual([lod.nx, lod.ny]);
    expect(count(r.on)).toBe(lod.dots_on);
    expect(r.postfx).toEqual(lod.postfx);
    const s = lod.samples;
    const idx = s.dots.map(([j, i]) => j * r.nx + i);
    expect(idx.map((k) => r.dotRadius[k])).toEqual(s.dot_radius);
    expect(idx.map((k) => [r.dotColor[3 * k], r.dotColor[3 * k + 1], r.dotColor[3 * k + 2]])).toEqual(s.dot_color);
  });
});

describe('toText', () => {
  test('vector del §6: on[0,0] y on[3,1] en una rejilla de 8 filas × 4 columnas', () => {
    const on = new Uint8Array(8 * 4);
    on[0] = 1;
    on[3 * 4 + 1] = 1;
    expect(toText(on, 4, 8)).toBe(`${String.fromCharCode(0x2800 + 0x01 + 0x80)}⠀\n⠀⠀`);
  });

  test('recorta a múltiplos de 4 filas y 2 columnas, con LF y sin salto final', () => {
    const on = new Uint8Array(10 * 5).fill(1);
    expect(toText(on, 5, 10)).toBe('⣿⣿\n⣿⣿');
  });
});

describe('renderFromSeed', () => {
  test('sortea los rasgos con subRng(seed, "traits") y respeta los fijados', () => {
    const seed = tokenSeed(20261104, 4242);
    const fixed = { phenomenon: 'none', palette: 'monochrome' } as const;
    const r = renderFromSeed(seed, { columns: 48, fixed });
    const traits = drawTraits(subRng(seed, 'traits'), fixed);
    expect(r.traits).toEqual(traits);
    expect(r.text).toBe(renderBraille(traits, seed, { columns: 48 }).text);
  });

  test('en 48 columnas los destellos nunca salen de la rejilla (Review Focus 3)', () => {
    for (let i = 1; i <= 60; i++) {
      const r = renderFromSeed(tokenSeed(20261104, 30000 + i), { columns: 48, fixed: { phenomenon: 'none' } });
      expect(r.on).toHaveLength(96 * 96);
      expect(r.text.split('\n')).toHaveLength(24);
    }
  });
});
