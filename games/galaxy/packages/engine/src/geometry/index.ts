import type { Geometry } from './common';
import { elliptical, lenticular } from './elliptical';
import { dwarf, irregular } from './irregular';
import { ring } from './ring';
import { barredSpiral, spiral } from './spiral';

// Single-disk types (DISK_GEOMETRIES). Mergers have their own function: two galaxies.
const DISK_GEOMETRIES: Readonly<Record<string, Geometry>> = {
  spiral,
  barred_spiral: barredSpiral,
  elliptical,
  lenticular,
  irregular,
  ring,
  dwarf,
};

export function diskGeometry(type: string): Geometry {
  const g = DISK_GEOMETRIES[type];
  if (!g) throw new RangeError(`no disk geometry for galaxy type ${type}`);
  return g;
}

export * from './common';
export { barredSpiral, dwarf, elliptical, irregular, lenticular, ring, spiral };
