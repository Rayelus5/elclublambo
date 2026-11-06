import type { Lod } from '@galaxy/engine';
import { useCallback, useEffect, useState } from 'react';
import { composeInto } from '../galaxy/compose';
import { loadRender, watchVisibility } from '../galaxy/images';

export type ImageState = 'waiting' | 'loading' | 'ready' | 'error';
type Result = { key: string; canvas?: HTMLCanvasElement };

/**
 * The composed image of a galaxy for a card, loaded only while its element is on (or near) the screen. Attach `ref` to
 * the card; `canvas` is a fresh canvas of `size` CSS pixels (× devicePixelRatio, at most 1024) once it is ready. A card
 * that scrolls away before its turn never reaches the Worker, and one that leaves the screen lets its canvas go, so a
 * collection of thousands keeps only what is near the screen in memory (the render cache makes coming back cheap).
 */
export function useGalaxyImage(seed: string, columns: Lod, size: number) {
  const [el, setEl] = useState<Element | null>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const key = `${seed}:${columns}:${size}`;
  const ref = useCallback((node: Element | null) => setEl(node), []);

  useEffect(() => {
    if (!el) return;
    return watchVisibility(el, (on) => {
      setVisible(on);
      if (!on) setResult(null);
    });
  }, [el]);

  const settled = result?.key === key;
  useEffect(() => {
    if (!visible || settled) return;
    const controller = new AbortController();
    loadRender(BigInt(seed), columns, controller.signal).then(
      (render) => {
        if (controller.signal.aborted) return;
        const canvas = document.createElement('canvas');
        const px = Math.min(1024, Math.round(size * (globalThis.devicePixelRatio || 1)));
        setResult(composeInto(canvas, render, px) ? { key, canvas } : { key });
      },
      (error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError') setResult({ key });
      },
    );
    return () => controller.abort();
  }, [visible, settled, key, seed, columns, size]);

  const state: ImageState = settled ? (result.canvas ? 'ready' : 'error') : visible ? 'loading' : 'waiting';
  return { ref, canvas: settled ? result.canvas : undefined, state };
}
