import { describe, expect, test } from 'vitest';
import { BrailleGrid, buildParams, diskGeometry, makeFrame } from '../src/index';
import { expectClose, LODS, loadCases, lodOf } from './golden';

// ENGINE_PORT §5.3: frame and raw disk density of every non-merger case, at its sample dots and in the three LODs.
// libm (UCRT vs fdlibm) may differ by an ulp in exp/log/cos/atan2/pow: relative error ≤ 1e-12.
const REL = 1e-12;
const cases = loadCases().filter((c) => c.traits.galaxy_type !== 'merger');

describe.each(cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
  test.each(LODS)('marco y densidad del disco en %i columnas', (columns) => {
    const s = lodOf(c, columns).samples;
    const grid = new BrailleGrid(2048, 2048, columns);
    const { u: uAll, v: vAll } = grid.dotUv();
    const u = Float64Array.from(s.dots, ([, i]) => uAll[i]!);
    const v = Float64Array.from(s.dots, ([j]) => vAll[j]!);
    const p = buildParams(c.traits, BigInt(c.seed), grid.snap(0, 0));
    const f = makeFrame(u, v, p.cx, p.cy, p.size, p.angle, p.tilt);
    expectClose(f.r, s.frame_r!, REL, 'frame.r');
    expectClose(f.th, s.frame_th!, REL, 'frame.th');
    const { d, young } = diskGeometry(p.type)(f, p, p.noise_seed);
    expectClose(d, s.disk_d!, REL, 'd');
    expectClose(young, s.disk_young!, REL, 'young');
    expect(
      d.some((x) => x > 0),
      'some galaxy inside the samples',
    ).toBe(true);
  });
});
