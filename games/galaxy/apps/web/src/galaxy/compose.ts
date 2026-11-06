import type { BrailleRender } from '@galaxy/engine';
import { composeFallback, composeWebGL } from '@galaxy/engine/gpu';

// Every galaxy image of the app is composed in ONE WebGL2 canvas kept off the page (GDD §18.3) and copied into the
// target's plain 2D canvas: browsers cap live WebGL contexts, so cards and the backdrop never own one each. A lost
// context gets a fresh canvas next time; no WebGL2, no float targets or a broken driver: 2D (no glow) from then on.
let gpuCanvas: HTMLCanvasElement | null = null;
let gpuBroken = false;

/** Draws `render` into `target` at `size`×`size` pixels. Returns how it was drawn, or null without a 2D context. */
export function composeInto(target: HTMLCanvasElement, render: BrailleRender, size: number): 'webgl' | '2d' | null {
  target.width = size;
  target.height = size;
  const ctx = target.getContext('2d');
  if (!ctx) return null;
  if (!gpuBroken) {
    gpuCanvas ??= document.createElement('canvas');
    if (composeWebGL(gpuCanvas, render, size)) {
      ctx.drawImage(gpuCanvas, 0, 0);
      return 'webgl';
    }
    if (gpuCanvas.getContext('webgl2')?.isContextLost()) gpuCanvas = null;
    else gpuBroken = true;
  }
  composeFallback(ctx, render, size);
  return '2d';
}
