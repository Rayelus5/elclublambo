import { CLAN_COLORS, CLAN_EMBLEMS } from '@galaxy/shared';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { clanEmblemOffset, clanEmblemUrl } from '../src/clans/emblems';

// The clans' emblems (GDD §14.3, DESIGN_SYSTEM §8 duodecies; M5b-1 Task 4): painted in Aseprite
// (art/clans/paint-emblems.lua), each emblem a strip of its six colours at 32×32, in CLAN_COLORS order.

const dir = join(process.cwd(), 'apps/web/src/clans/emblems');

/** A PNG's rows as unfiltered bytes (8-bit channels). */
function rows(buf: Buffer): { bpp: number; rows: Buffer[] } {
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
  return { bpp, rows: out };
}

test('cada emblema es una tira de sus seis colores a 32×32, y no sobra ninguno', () => {
  for (const emblem of CLAN_EMBLEMS) {
    expect(clanEmblemUrl(emblem), emblem).toBeTruthy();
    const png = readFileSync(join(dir, `${emblem}.png`));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)], emblem).toEqual([32 * CLAN_COLORS.length, 32]);
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.slice(0, -4));
  expect(new Set(files)).toEqual(new Set(CLAN_EMBLEMS));
});

test('los seis colores de cada emblema son distintos entre sí, y cada color es su desplazamiento en la tira', () => {
  for (const emblem of CLAN_EMBLEMS) {
    const { bpp, rows: r } = rows(readFileSync(join(dir, `${emblem}.png`)));
    const variant = (c: number) => Buffer.concat(r.map((line) => line.subarray(c * 32 * bpp, (c + 1) * 32 * bpp))).toString('hex');
    expect(new Set(CLAN_COLORS.map((_, c) => variant(c))).size, emblem).toBe(CLAN_COLORS.length);
  }
  expect(CLAN_COLORS.map(clanEmblemOffset)).toEqual(['0%', '20%', '40%', '60%', '80%', '100%']);
});
