import { expect, test } from 'vitest';
import { imageInfo } from '../../src/news/image';

// An uploaded image is what its bytes say (PNG, JPEG or WebP, with its size), never what its name claims.

const png = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};

const jpeg = (w: number, h: number) =>
  Buffer.from([
    0xff, 0xd8,
    // An APP0 segment first (skipped).
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    // SOF0: length 17, precision 8, height, width.
    0xff, 0xc0, 0x00, 0x11, 0x08, (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);

const webpX = (w: number, h: number) => {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1');
  b.write('WEBP', 8, 'latin1');
  b.write('VP8X', 12, 'latin1');
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
};

test('reconoce PNG, JPEG y WebP con su tamaño', () => {
  expect(imageInfo(png(960, 540))).toEqual({ mime: 'image/png', width: 960, height: 540 });
  expect(imageInfo(jpeg(1280, 720))).toEqual({ mime: 'image/jpeg', width: 1280, height: 720 });
  expect(imageInfo(webpX(1920, 1080))).toEqual({ mime: 'image/webp', width: 1920, height: 1080 });
});

test('rechaza lo que no es una imagen, lo cortado y lo enorme', () => {
  expect(imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
  expect(imageInfo(Buffer.from('GIF89a......'))).toBeNull();
  expect(imageInfo(png(960, 540).subarray(0, 20))).toBeNull();
  expect(imageInfo(jpeg(10, 10).subarray(0, 12))).toBeNull();
  expect(imageInfo(png(9000, 10))).toBeNull();
  expect(imageInfo(png(0, 10))).toBeNull();
});
