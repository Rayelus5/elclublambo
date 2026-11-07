import { Rng } from '@galaxy/sim';

// Decoration of the sector's ground (DESIGN_SYSTEM §8 quater): nebula clouds, rocks and braille dust, placed per chunk
// from the run seed, so the same run always looks the same and nothing collides.

export const CHUNK = 256;

export interface Decor {
  kind: 'cloud' | 'rock' | 'dust';
  x: number;
  y: number;
  variant: number;
  scale: number;
}

export function terrainAt(cx: number, cy: number, seed: string): Decor[] {
  // A stream per chunk: the chunk's coordinates fold into the stream name.
  const rng = Rng.fromSeed(seed, `terrain:${cx}:${cy}`);
  const out: Decor[] = [];
  const at = () => ({ x: cx * CHUNK + rng.float() * CHUNK, y: cy * CHUNK + rng.float() * CHUNK });
  if (rng.chance(0.55)) out.push({ kind: 'cloud', ...at(), variant: rng.int(4), scale: 1 + rng.int(2) });
  const rocks = rng.int(3);
  for (let k = 0; k < rocks; k++) out.push({ kind: 'rock', ...at(), variant: rng.int(3), scale: 1 });
  const dust = 3 + rng.int(6);
  for (let k = 0; k < dust; k++) out.push({ kind: 'dust', ...at(), variant: rng.int(6), scale: 1 });
  return out;
}
