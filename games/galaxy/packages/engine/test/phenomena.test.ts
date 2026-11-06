import { describe, expect, test } from 'vitest';
import {
  BrailleGrid,
  buildParams,
  galaxyField,
  galaxyMatter,
  lightLayer,
  loadPalette,
  RENDER,
  renderBraille,
  renderFromSeed,
  subRng,
  subSeed32,
  tokenSeed,
  VISUALS,
} from '../src/index';
import { expectClose, LODS, loadCases, lodOf } from './golden';

// ENGINE_PORT §5.7: matter (satellite, globular clusters), light (supernova, comet, jets, pulsar, Einstein ring)
// and the Anomaly glitch, against every case with a phenomenon in the three LODs.
const withPhenomenon = loadCases().filter((c) => c.traits.phenomenon !== 'none');

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
        if (!first) first = `row ${r}, column ${col}`;
      }
    }
  }
  return `${cells} cells differ; first at ${first}`;
}

describe.each(withPhenomenon.map((c) => [c.name, c] as const))('%s', (_, c) => {
  test.each(LODS)('braille idéntico en %i columnas', (columns) => {
    const lod = lodOf(c, columns);
    const r = renderBraille(c.traits, BigInt(c.seed), { columns });
    expect(diff(r.text, lod.braille)).toBeNull();
    expect(r.on.reduce((s, x) => s + x, 0)).toBe(lod.dots_on);
    expect(r.postfx).toEqual(lod.postfx);
    const s = lod.samples;
    const idx = s.dots.map(([j, i]) => j * r.nx + i);
    expect(idx.map((k) => r.dotRadius[k])).toEqual(s.dot_radius);
    expect(idx.map((k) => [r.dotColor[3 * k], r.dotColor[3 * k + 1], r.dotColor[3 * k + 2]])).toEqual(s.dot_color);
  });

  test.each(LODS)('luz y materia del fenómeno en las muestras, %i columnas', (columns) => {
    const s = lodOf(c, columns).samples;
    const grid = new BrailleGrid(RENDER.width, RENDER.height, columns);
    const { u: uAll, v: vAll } = grid.dotUv();
    const u = Float64Array.from(s.dots, ([, i]) => uAll[i]!);
    const v = Float64Array.from(s.dots, ([j]) => vAll[j]!);
    const seed = BigInt(c.seed);
    const kind = c.traits.phenomenon;
    const spec = VISUALS.phenomenon[kind] ?? {};
    const rng = subRng(seed, 'phenomenon');
    const seed32 = subSeed32(seed, 'phenomenon');
    const p = buildParams(c.traits, seed, grid.snap(0, 0));
    const matter = galaxyMatter(kind, u, v, p, spec, rng, seed32);
    expectClose(galaxyField(u, v, p, RENDER.density_gain, grid.uvStep, matter).t, s.gal_t, 1e-12, 'gal.t');
    const light = lightLayer(kind, u, v, p, loadPalette(c.traits.palette), spec, rng, grid, seed32);
    if (s.light_t === null) expect(light).toBeNull();
    else expect(Array.from(light!.t)).toEqual(s.light_t);
  });
});

test('hay un caso por cada uno de los 8 fenómenos', () => {
  expect(new Set(withPhenomenon.map((c) => c.traits.phenomenon)).size).toBe(8);
});

test('ningún fenómeno lanza ni se sale de la rejilla en 48 columnas (Review Focus 3)', () => {
  const kinds = ['anomaly', 'supernova', 'comet', 'pulsar', 'einstein_ring', 'satellite_galaxy', 'globular_cluster'];
  for (const phenomenon of kinds) {
    for (let i = 1; i <= 15; i++) {
      const r = renderFromSeed(tokenSeed(20261104, 40000 + 100 * kinds.indexOf(phenomenon) + i), {
        columns: 48,
        fixed: { phenomenon, ...(phenomenon === 'einstein_ring' ? { galaxy_type: 'spiral' } : {}) },
      });
      expect(r.text.split('\n'), phenomenon).toHaveLength(24);
    }
  }
  for (let i = 1; i <= 15; i++) {
    const r = renderFromSeed(tokenSeed(20261104, 41000 + i), { columns: 48, fixed: { core: 'quasar', phenomenon: 'relativistic_jets' } });
    expect(r.text.split('\n')).toHaveLength(24);
  }
});
