import { describe, expect, test } from 'vitest';
import { commands } from 'vitest/browser';
import { composeFallback, composeWebGL, renderBraille, type Traits } from '../../src/index';
import meta from '../golden/v1/meta.json';

// ENGINE_PORT §7 in real Chromium: the WebGL2 compose against the Python PNGs (2048 px, reduced to 256 px). The two
// downscalers differ (Pillow LANCZOS vs the browser's high-quality drawImage) and the shader runs in float32, so the
// comparison is statistical: mean absolute error per channel and its 99th percentile, in 0–255 levels.
const MEAN_MAX = 6;
const P99_MAX = 40;

type Case = { name: string; seed: string; traits: Traits; image: string | null };
// The golden files are read by the Vitest server (paths relative to the Vitest root, games/galaxy).
const read = (file: string, encoding?: 'base64') => commands.readFile(`packages/engine/test/golden/v1/${file}`, encoding);
const cases: Case[] = await Promise.all(meta.images.map(async (name) => JSON.parse(await read(`cases/${name}.json`)) as Case));

function pixels(source: CanvasImageSource, size = 256): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

function error(a: Uint8ClampedArray, b: Uint8ClampedArray): { mean: number; p99: number } {
  const diffs: number[] = [];
  for (let i = 0; i < a.length; i += 4) for (let ch = 0; ch < 3; ch++) diffs.push(Math.abs(a[i + ch]! - b[i + ch]!));
  diffs.sort((x, y) => x - y);
  return { mean: diffs.reduce((s, d) => s + d, 0) / diffs.length, p99: diffs[Math.floor(diffs.length * 0.99)]! };
}

async function golden(c: Case): Promise<Uint8ClampedArray> {
  const bytes = Uint8Array.from(atob(await read(c.image!, 'base64')), (ch) => ch.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  return pixels(bitmap);
}

describe.each(cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
  test('la composición WebGL2 se parece a la imagen de Python', async () => {
    const render = renderBraille(c.traits, BigInt(c.seed), { columns: 192 });
    const canvas = document.createElement('canvas');
    expect(composeWebGL(canvas, render, 2048)).toBe(true);
    const e = error(pixels(canvas), await golden(c));
    console.log(`${c.name}: mean ${e.mean.toFixed(2)}, p99 ${e.p99}`);
    expect(e.mean).toBeLessThanOrEqual(MEAN_MAX);
    expect(e.p99).toBeLessThanOrEqual(P99_MAX);
  });
});

test('sin contexto WebGL2 (perdido) devuelve false sin lanzar', () => {
  const c = cases[0]!;
  const render = renderBraille(c.traits, BigInt(c.seed), { columns: 48 });
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true })!;
  gl.getExtension('WEBGL_lose_context')!.loseContext();
  expect(composeWebGL(canvas, render, 256)).toBe(false);
});

test('el respaldo 2D dibuja los puntos sobre el fondo (Review Focus 4)', async () => {
  const c = cases[0]!;
  const render = renderBraille(c.traits, BigInt(c.seed), { columns: 192 });
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  composeFallback(canvas.getContext('2d')!, render, 512);
  const got = pixels(canvas);
  const want = await golden(c);
  // No glow, so darker than the original, but the galaxy is there.
  let lit = 0;
  for (let i = 0; i < got.length; i += 4) if (got[i]! + got[i + 1]! + got[i + 2]! > 120) lit++;
  expect(lit).toBeGreaterThan(200);
  expect(error(got, want).mean).toBeLessThan(30);
});
