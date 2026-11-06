import type { Palette } from './color';
import type { PhenomenonVisual } from './config/types';
import type { GalaxyParams } from './geometry/common';
import type { BrailleGrid } from './raster';
import type { Generator } from './rng/generator';

// phenomena.py (ENGINE_PORT §5.7). Task 8 renders galaxies without a phenomenon; Task 9 ports the phenomena.
export interface LightLayer {
  /** Density of the phenomenon's light, float32. */
  t: Float32Array;
  /** Linear colour, float32, n × 3. */
  color: Float32Array;
}

function notYet(kind: string): never {
  throw new RangeError(`phenomenon ${kind} is not ported yet`);
}

export function galaxyMatter(
  kind: string,
  _u: Float64Array,
  _v: Float64Array,
  _p: GalaxyParams,
  _spec: PhenomenonVisual,
  _rng: Generator,
  _seed: number,
): { d: Float64Array; young: Float64Array } | null {
  return kind === 'none' ? null : notYet(kind);
}

export function lightLayer(
  kind: string,
  _u: Float64Array,
  _v: Float64Array,
  _p: GalaxyParams,
  _palette: Palette,
  _spec: PhenomenonVisual,
  _rng: Generator,
  _grid: BrailleGrid,
  _seed: number,
): LightLayer | null {
  return kind === 'none' ? null : notYet(kind);
}

export function glitch(
  _on: Uint8Array,
  _color: Float32Array,
  _radius: Float32Array,
  _nx: number,
  _ny: number,
  _palette: Palette,
  _spec: PhenomenonVisual,
  _rng: Generator,
  _dotRadius: number,
): void {
  notYet('anomaly');
}
