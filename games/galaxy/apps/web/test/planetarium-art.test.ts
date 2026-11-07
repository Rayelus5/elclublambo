import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { DOME, domeUrl } from '../src/planetarium/art';

// The planetarium's dome (GDD §10.5, DESIGN_SYSTEM §8 decies; M4c-2 Task 5): painted in Aseprite
// (art/planetarium/paint-planetarium.lua) as a strip of eight 192×96 frames: the projector turns and the stars travel
// across the dome, so every frame differs from the one before; six pedestals stand where the cards go.

// Vitest runs from games/galaxy (jsdom's import.meta.url is not a file URL).
const file = join(process.cwd(), 'apps/web/src/planetarium/art/dome.png');

/** A PNG's pixels as one byte array per row (8-bit channels, unfiltered). */
function decode(buf: Buffer): { width: number; height: number; bpp: number; rows: Buffer[] } {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  expect(buf[24], 'bit depth').toBe(8);
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[buf[25]!]!;
  const idat: Buffer[] = [];
  for (let at = 8; at < buf.length; ) {
    const len = buf.readUInt32BE(at);
    if (buf.toString('ascii', at + 4, at + 8) === 'IDAT') idat.push(buf.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const rows: Buffer[] = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const add = [0, a, b, (a + b) >> 1, paeth][filter]!;
      line[i] = (line[i]! + add) & 0xff;
    }
    rows.push(line);
    prev = line;
  }
  return { width, height, bpp, rows };
}

test('la cúpula es una tira de ocho fotogramas de 192×96 servida como archivo', () => {
  expect(domeUrl).toBeTruthy();
  const png = readFileSync(file);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([DOME.width * DOME.frames, DOME.height]);
  expect(DOME).toMatchObject({ width: 192, height: 96, frames: 8 });
});

test('cada fotograma es distinto del anterior: el proyector gira y las estrellas se mueven', () => {
  const { bpp, rows } = decode(readFileSync(file));
  const frame = (f: number) => Buffer.concat(rows.map((r) => r.subarray(f * DOME.width * bpp, (f + 1) * DOME.width * bpp)));
  for (let f = 0; f < DOME.frames; f++) expect(frame(f).equals(frame((f + 1) % DOME.frames)), `fotograma ${f}`).toBe(false);
});

test('seis pedestales a cada lado del proyector, dentro de la cúpula', () => {
  expect(DOME.pedestals).toHaveLength(6);
  expect(DOME.pedestals.slice(0, 3).every((x) => x < DOME.width / 2)).toBe(true);
  expect(DOME.pedestals.slice(3).every((x) => x > DOME.width / 2)).toBe(true);
  for (const x of DOME.pedestals) expect(x).toBeGreaterThan(0);
  expect(DOME.pedestalTop).toBeLessThan(DOME.height);
});
