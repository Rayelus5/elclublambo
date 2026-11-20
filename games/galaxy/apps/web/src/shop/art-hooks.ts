import { type RefObject, useEffect } from 'react';
import { paintPack, type PackArt, whenStrip } from './art';

// The packs' sparkles (shop and lab plan, F5): every pack canvas on screen joins one animation loop (one frame for all
// of them, not one each); with reduced motion each is painted once, still. A canvas leaves the loop when it unmounts.

const live = new Map<HTMLCanvasElement, PackArt>();
let raf = 0;

function loop(t: number) {
  for (const [canvas, art] of live) paintPack(canvas, art, t);
  raf = live.size > 0 ? requestAnimationFrame(loop) : 0;
}

/** Paints the pack on its canvas and, unless motion is reduced, keeps its sparkles twinkling. */
export function usePackArt(ref: RefObject<HTMLCanvasElement | null>, art: PackArt, reduced: boolean): void {
  const { kind, tier } = art;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const a = { kind, tier };
    paintPack(canvas, a, 0);
    // The sprites' strip may still be on its way: paint again once it is here.
    const stop = whenStrip(() => paintPack(canvas, a, 0));
    if (reduced || typeof requestAnimationFrame !== 'function') return stop;
    live.set(canvas, a);
    if (!raf) raf = requestAnimationFrame(loop);
    return () => {
      stop();
      live.delete(canvas);
    };
  }, [ref, kind, tier, reduced]);
}

/** Euros as Spain writes them: «3,99 €». */
export function eur(cents: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}
