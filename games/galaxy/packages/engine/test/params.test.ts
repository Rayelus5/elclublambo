import { describe, expect, test } from 'vitest';
import { BrailleGrid, buildParams, type Traits } from '../src/index';
import { LODS, loadCases, loadGolden, lodOf } from './golden';

// ENGINE_PORT §1.3, §2.5 and §5.1: the grid of each LOD and build_params, number for number.
type Lod = { center: [number, number]; uv_step: number; params: Record<string, unknown> };
type GridGolden = {
  cell_w: number;
  cell_h: number;
  rows: number;
  step: number;
  nx: number;
  ny: number;
  oy: number;
  uv_step: number;
  snap_origin: [number, number];
  u_first: number[];
  v_first: number[];
  u_last: number;
  v_last: number;
};
const golden = loadGolden<{
  tokens: Array<{ token_id: number; seed: string; traits: Traits; lods: Record<string, Lod> }>;
  grids: Record<string, GridGolden>;
}>('params.json');

describe('rejilla braille', () => {
  test.each(LODS)('%i columnas', (columns) => {
    const g = golden.grids[String(columns)]!;
    const grid = new BrailleGrid(2048, 2048, columns);
    expect([grid.cellW, grid.cellH, grid.rows, grid.step, grid.nx, grid.ny, grid.oy, grid.uvStep]).toEqual([
      g.cell_w,
      g.cell_h,
      g.rows,
      g.step,
      g.nx,
      g.ny,
      g.oy,
      g.uv_step,
    ]);
    expect(grid.snap(0, 0)).toEqual(g.snap_origin);
    const { u, v } = grid.dotUv();
    expect([u[0], u[1], u[2], u[grid.nx - 1]]).toEqual([...g.u_first, g.u_last]);
    expect([v[0], v[1], v[2], v[grid.ny - 1]]).toEqual([...g.v_first, g.v_last]);
  });
});

describe('build_params', () => {
  test.each(golden.tokens.map((t) => [t.token_id, t] as const))('token %i (Apéndice A) en las tres LOD', (_, t) => {
    for (const columns of LODS) {
      const lod = t.lods[String(columns)]!;
      expect(buildParams(t.traits, BigInt(t.seed), lod.center), `${columns}`).toEqual(lod.params);
    }
  });

  test('los parámetros de los 26 casos coinciden en las tres LOD', () => {
    for (const c of loadCases()) {
      for (const columns of LODS) {
        const params = lodOf(c, columns).params;
        const center: [number, number] = [params['cx'] as number, params['cy'] as number];
        expect(buildParams(c.traits, BigInt(c.seed), center), `${c.name} @${columns}`).toEqual(params);
      }
    }
  });
});
