// What an uploaded image really is, from its own bytes (never from its name or the browser's word): PNG, JPEG or WebP,
// with its width and height. Anything else, or a file cut short, is null and refused.

export interface ImageInfo {
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
}

const ascii = (b: Buffer, at: number, n: number) => b.toString('latin1', at, at + n);

export function imageInfo(b: Buffer): ImageInfo | null {
  // PNG: the signature, then the IHDR chunk with the width and height.
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a && ascii(b, 12, 4) === 'IHDR') {
    return sized('image/png', b.readUInt32BE(16), b.readUInt32BE(20));
  }
  // JPEG: SOI, then the segments until a start of frame (SOF0–SOF15 but DHT, JPG and DAC).
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let at = 2;
    while (at + 9 < b.length) {
      if (b[at] !== 0xff) return null;
      const marker = b[at + 1]!;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        at += 2;
        continue;
      }
      const length = b.readUInt16BE(at + 2);
      if (length < 2) return null;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return sized('image/jpeg', b.readUInt16BE(at + 7), b.readUInt16BE(at + 5));
      }
      at += 2 + length;
    }
    return null;
  }
  // WebP: RIFF…WEBP with one of its three kinds of first chunk.
  if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return sized('image/webp', b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
    if (chunk === 'VP8L' && b[20] === 0x2f) {
      const bits = b.readUInt32LE(21);
      return sized('image/webp', (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    if (chunk === 'VP8X') return sized('image/webp', b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1);
  }
  return null;
}

function sized(mime: ImageInfo['mime'], width: number, height: number): ImageInfo | null {
  return width >= 1 && height >= 1 && width <= 8192 && height <= 8192 ? { mime, width, height } : null;
}
