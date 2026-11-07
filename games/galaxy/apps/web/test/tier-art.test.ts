import { SEASON_TIERS } from '@galaxy/shared';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { TIER_FRAMES, tierArtUrl } from '../src/social/tiers';

// The season tiers' emblems (GDD §13.1, DESIGN_SYSTEM §8 undecies; M5a Task 4): painted in Aseprite
// (art/seasons/paint-tiers.lua) as strips of four 32×32 frames with a shine that sweeps the emblem, so every frame
// differs from the one before. One per tier, Bronce to Estelar, and none left over.

// Vitest runs from games/galaxy (jsdom's import.meta.url is not a file URL).
const dir = join(process.cwd(), 'apps/web/src/social/tiers');

/** A PNG's rows as unfiltered bytes (8-bit channels). */
function rows(buf: Buffer): { width: number; bpp: number; rows: Buffer[] } {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[buf[25]!]!;
  const idat: Buffer[] = [];
  for (let at = 8; at < buf.length; ) {
    const len = buf.readUInt32BE(at);
    if (buf.toString('ascii', at + 4, at + 8) === 'IDAT') idat.push(buf.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out: Buffer[] = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      line[i] = (line[i]! + [0, a, b, (a + b) >> 1, paeth][filter]!) & 0xff;
    }
    out.push(line);
    prev = line;
  }
  return { width, bpp, rows: out };
}

test('cada tramo tiene su emblema: una tira de cuatro fotogramas de 32×32, y no sobra ninguno', () => {
  for (const tier of SEASON_TIERS) {
    expect(tierArtUrl(tier), tier).toBeTruthy();
    const png = readFileSync(join(dir, `${tier}.png`));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)], tier).toEqual([32 * TIER_FRAMES, 32]);
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.slice(0, -4));
  expect(new Set(files)).toEqual(new Set(SEASON_TIERS));
});

test('cada fotograma es distinto del anterior: el brillo recorre el emblema', () => {
  for (const tier of SEASON_TIERS) {
    const { bpp, rows: r } = rows(readFileSync(join(dir, `${tier}.png`)));
    const frame = (f: number) => Buffer.concat(r.map((line) => line.subarray(f * 32 * bpp, (f + 1) * 32 * bpp)));
    for (let f = 0; f < TIER_FRAMES; f++) expect(frame(f).equals(frame((f + 1) % TIER_FRAMES)), `${tier} fotograma ${f}`).toBe(false);
  }
});
