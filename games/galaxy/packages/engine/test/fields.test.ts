import { describe, expect, test } from 'vitest';
import { backgroundField, BrailleGrid, buildParams, galaxyField, loadPalette, RENDER, subRng, subSeed32, VISUALS } from '../src/index';
import { expectClose, LODS, loadCases, lodOf } from './golden';

// ENGINE_PORT §5.2, §5.3 (merger) and §5.5: the galaxy field and the background field at every case's sample dots.
// gal.t within 1e-12 (libm ulps); t_bg is rounded to float32 before it touches a dot, so it must be identical.
const REL = 1e-12;
// Satellite galaxies and globular clusters add matter to the galaxy field: that is Task 9's phenomena.
const WITH_MATTER = new Set(['satellite_galaxy', 'globular_cluster']);
const cases = loadCases();

function sampleUv(columns: (typeof LODS)[number], dots: Array<[number, number]>) {
  const grid = new BrailleGrid(RENDER.width, RENDER.height, columns);
  const { u, v } = grid.dotUv();
  return {
    grid,
    u: Float64Array.from(dots, ([, i]) => u[i]!),
    v: Float64Array.from(dots, ([j]) => v[j]!),
  };
}

describe.each(cases.filter((c) => !WITH_MATTER.has(c.traits.phenomenon)).map((c) => [c.name, c] as const))(
  'campo de galaxia: %s',
  (_, c) => {
    test.each(LODS)('%i columnas', (columns) => {
      const s = lodOf(c, columns).samples;
      const { grid, u, v } = sampleUv(columns, s.dots);
      const p = buildParams(c.traits, BigInt(c.seed), grid.snap(0, 0));
      const gal = galaxyField(u, v, p, RENDER.density_gain, grid.uvStep);
      expectClose(gal.t, s.gal_t, REL, 'gal.t');
      expectClose(gal.young, s.gal_young, REL, 'gal.young');
      expect(
        gal.t.some((x) => x > 0.035),
        'the samples reach the galaxy',
      ).toBe(true);
    });
  },
);

describe.each(cases.map((c) => [c.name, c] as const))('fondo: %s', (_, c) => {
  test.each(LODS)('%i columnas', (columns) => {
    const s = lodOf(c, columns).samples;
    const { u, v } = sampleUv(columns, s.dots);
    const seed = BigInt(c.seed);
    const bg = backgroundField(
      u,
      v,
      c.traits.background,
      VISUALS.background[c.traits.background]!,
      loadPalette(c.traits.palette),
      subSeed32(seed, 'background'),
      subRng(seed, 'background'),
    );
    expect(Array.from(bg.t)).toEqual(s.t_bg);
    expect(bg.color).toHaveLength(3 * s.dots.length);
  });
});

test('las fusiones usan la semilla de B + 101 y centran las espigas del quásar en (cx, cy)', () => {
  // Covered by the merger cases above (16 and 17, plus any merger filler); this pins that they exist.
  const mergers = cases.filter((c) => c.traits.galaxy_type === 'merger' && !WITH_MATTER.has(c.traits.phenomenon));
  expect(mergers.length).toBeGreaterThanOrEqual(2);
  expect(mergers.some((c) => c.lods['192'].params['extra'] && (c.lods['192'].params['extra'] as { b_kind: string }).b_kind === 'spiral')).toBe(true);
});
