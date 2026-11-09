import { describe, expect, test } from 'vitest';
import { commands } from 'vitest/browser';
import { composeFallback, composeWebGL } from '../../src/gpu/index';
import { renderBraille, type BrailleRender, type Traits } from '../../src/index';
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

/**
 * Composing at 2048 px in software WebGL (SwiftShader) and sorting every pixel's difference is heavy: a shared CI
 * runner has taken over the browser project's 15 s on some runs. These get room of their own.
 */
const HEAVY_MS = 45_000;

describe.each(cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
  test('la composición WebGL2 se parece a la imagen de Python', async () => {
    const render = renderBraille(c.traits, BigInt(c.seed), { columns: 192 });
    const canvas = document.createElement('canvas');
    expect(composeWebGL(canvas, render, 2048)).toBe(true);
    const e = error(pixels(canvas), await golden(c));
    console.log(`${c.name}: mean ${e.mean.toFixed(2)}, p99 ${e.p99}`);
    expect(e.mean).toBeLessThanOrEqual(MEAN_MAX);
    expect(e.p99).toBeLessThanOrEqual(P99_MAX);
  }, HEAVY_MS);
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

test('tras perder y recuperar el contexto vuelve a dibujar (no reutiliza programas muertos)', async () => {
  const c = cases[0]!;
  const render = renderBraille(c.traits, BigInt(c.seed), { columns: 48 });
  const canvas = document.createElement('canvas');
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  expect(composeWebGL(canvas, render, 256)).toBe(true);
  const gl = canvas.getContext('webgl2')!;
  const lose = gl.getExtension('WEBGL_lose_context')!;
  const lost = new Promise((resolve) => canvas.addEventListener('webglcontextlost', resolve, { once: true }));
  lose.loseContext();
  await lost; // restoring only works once the (default-prevented) lost event has been dispatched
  expect(composeWebGL(canvas, render, 256)).toBe(false);
  const restored = new Promise((resolve) => canvas.addEventListener('webglcontextrestored', resolve, { once: true }));
  await new Promise((resolve) => setTimeout(resolve, 200)); // Chrome restores only after the loss has settled
  lose.restoreContext();
  await restored;
  expect(composeWebGL(canvas, render, 256)).toBe(true);
  const p = pixels(canvas);
  let lit = 0;
  for (let i = 0; i < p.length; i += 4) if (p[i]! + p[i + 1]! + p[i + 2]! > 90) lit++;
  expect(lit).toBeGreaterThan(50);
});

test('un punto apagado no oscurece el papel de Antimatter al componer pequeño', async () => {
  const c = JSON.parse(await read('cases/07_elliptical_supernova_antimatter.json')) as Case;
  const r = renderBraille(c.traits, BigInt(c.seed), { columns: 192 });
  const off: BrailleRender = { ...r, dotRadius: new Float32Array(r.dotRadius.length).fill(-1), dotColor: new Float32Array(r.dotColor.length) };
  const centre = (size: number) => {
    const canvas = document.createElement('canvas');
    expect(composeWebGL(canvas, off, size)).toBe(true);
    const p = pixels(canvas, size);
    const o = 4 * ((size / 2) * size + size / 2);
    return [p[o]!, p[o + 1]!, p[o + 2]!];
  };
  const big = centre(1024);
  for (const size of [256, 512]) {
    centre(size).forEach((v, ch) => expect(Math.abs(v - big[ch]!), `${size} px`).toBeLessThanOrEqual(1));
  }
}, HEAVY_MS);
