import { describe, expect, test } from 'vitest';
import { composeFallback, composeWebGL } from '../src/gpu/index';
import { renderBraille, type BrailleRender } from '../src/index';
import { loadCases } from './golden';

// The compositor's failure and scaling paths that real Chromium does not reach easily (final review M2a).
const antimatter = loadCases().find((c) => c.traits.palette === 'antimatter')!;

function withAllDotsOff(r: BrailleRender): BrailleRender {
  return { ...r, dotRadius: new Float32Array(r.dotRadius.length).fill(-1), dotColor: new Float32Array(r.dotColor.length) };
}

/** composeFallback into a fake 2D context; returns the RGBA pixels. */
function fallback(r: BrailleRender, size: number): Uint8ClampedArray {
  let pixels: Uint8ClampedArray = new Uint8ClampedArray(0);
  const ctx = {
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: (image: { data: Uint8ClampedArray }) => {
      pixels = image.data;
    },
  };
  composeFallback(ctx as unknown as CanvasRenderingContext2D, r, size);
  return pixels;
}

describe('composición', () => {
  test('un punto apagado no cubre nada a ningún tamaño: el papel de Antimatter no se oscurece al reducir', () => {
    const off = withAllDotsOff(renderBraille(antimatter.traits, BigInt(antimatter.seed), { columns: 192 }));
    const centre = (size: number) => {
      const p = fallback(off, size);
      const o = 4 * ((size / 2) * size + size / 2);
      return [p[o], p[o + 1], p[o + 2]];
    };
    expect(centre(256)).toEqual(centre(1024));
    expect(centre(512)).toEqual(centre(1024));
  });

  test('composeWebGL devuelve false (no lanza) si un shader no compila, para que se use el respaldo 2D', () => {
    const gl = new Proxy(
      {},
      {
        get: (_, prop) => {
          if (prop === 'isContextLost') return () => false;
          if (prop === 'getExtension') return () => ({});
          if (prop === 'getShaderParameter' || prop === 'getProgramParameter') return () => false;
          if (prop === 'getShaderInfoLog' || prop === 'getProgramInfoLog') return () => 'ERROR: 0:1: syntax error';
          if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return 1;
          return () => ({});
        },
      },
    );
    const canvas = { width: 0, height: 0, getContext: () => gl } as unknown as HTMLCanvasElement;
    const r = renderBraille(antimatter.traits, BigInt(antimatter.seed), { columns: 48 });
    expect(composeWebGL(canvas, r, 64)).toBe(false);
  });
});
