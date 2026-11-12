import { drawTraits, fbmAt, hash2, linearToSrgb, loadPalette, subRng, type Lod, type Traits } from '@galaxy/engine';
import { useEffect, useRef } from 'react';
import { requestGalaxy, type GalaxyRender } from '../galaxy/client';
import { composeInto } from '../galaxy/compose';
import { galaxyReady, initialState, layerStyles, nextPhase } from './backdrop-schedule';
import { seedFor } from './backdrop-seeds';
import { prefersReduced } from '../settings/prefs';

// The access backdrop (DESIGN_SYSTEM §8): real galaxies from the engine on deep black, one at a time. Each one is
// scanned in by a braille scan line, turns and approaches very slowly (a rigid transform of the composed image, so
// its shape never changes) and cross-fades into the next. Two layers at most; one still galaxy with reduced motion.
// Every galaxy has a fresh random seed, so renders are never reused: nothing is cached. They are composed with the
// app's shared compositor (galaxy/compose.ts) into the layer's plain 2D canvas. On the title screen
// `seeds` are the player's own galaxies, shown exactly as they are (no trait fixed) and taking turns.
function randomSeed(): bigint {
  const words = new BigUint64Array(1);
  crypto.getRandomValues(words);
  return words[0]!;
}

/** A seed whose galaxy suits the dark access screen: no paper-white Antimatter, no Anomaly glitch. */
function pickGalaxy(): { seed: bigint; fixed: Partial<Traits> } {
  for (;;) {
    const seed = randomSeed();
    const fixed: Partial<Traits> = { background: seed & 1n ? 'starfield' : 'deep_void' };
    const traits = drawTraits(subRng(seed, 'traits'), fixed);
    if (traits.palette !== 'antimatter' && traits.phenomenon !== 'anomaly') return { seed, fixed };
  }
}

const css = (rgb: readonly number[], alpha = 1) =>
  `rgb(${rgb.map((c) => Math.round(linearToSrgb(c) * 255)).join(' ')} / ${alpha})`;

/**
 * An almost invisible dust: value noise through a Bayer 4×4 threshold jittered by a hash (pure Bayer reads as a
 * halftone grid), as a tiny pixelated image.
 */
function dustImage(): string {
  const w = 320;
  const h = 180;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'none';
  const image = ctx.createImageData(w, h);
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbmAt(x / 70, y / 70, 911, 3);
      const threshold = 0.55 * ((bayer[(y % 4) * 4 + (x % 4)]! + 0.5) / 16) + 0.45 * hash2(x, y, 97);
      if (n * n * 0.95 > threshold + 0.16) {
        const o = 4 * (y * w + x);
        image.data.set([190, 215, 255, 26], o);
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  return `url(${canvas.toDataURL('image/png')})`;
}

export function GalaxyBackdrop({ seeds = [] }: { seeds?: readonly string[] }) {
  const root = useRef<HTMLDivElement>(null);
  // Read when each galaxy is prepared, so new seeds apply from the next galaxy without restarting the sequence.
  const seedsRef = useRef(seeds);
  useEffect(() => {
    seedsRef.current = seeds;
  }, [seeds]);
  const layerA = useRef<HTMLDivElement>(null);
  const layerB = useRef<HTMLDivElement>(null);
  const reduced = prefersReduced();

  useEffect(() => {
    const host = root.current;
    const layers = [layerA.current, layerB.current].filter((l): l is HTMLDivElement => !!l);
    // Without Workers (or in jsdom) the static sky — gradient, vignette — is the whole backdrop.
    if (!host || layers.length === 0 || typeof Worker === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
    host.style.setProperty('--dust', dustImage());
    const controller = new AbortController();
    const tints = new Map<number, string>();
    let state = initialState(reduced);
    let clock = 0;
    let last = performance.now();
    let raf = 0;
    let requested = 0;
    let failures = 0;
    let tinted = 0;

    const slot = (id: number) => layers[id % layers.length]!;

    function draw(layer: HTMLDivElement, render: GalaxyRender): void {
      // clientWidth: the layout size, without the rotate/scale the slot still carries from its previous galaxy.
      const size = Math.min(2048, Math.max(256, Math.round(layer.clientWidth * devicePixelRatio)));
      let canvas = layer.querySelector('canvas');
      if (!canvas) {
        canvas = document.createElement('canvas');
        layer.prepend(canvas);
      }
      const drawn = composeInto(canvas, render, size);
      if (drawn) canvas.dataset['drawn'] = drawn;
    }

    async function prepare(id: number): Promise<void> {
      requested = id;
      const own = seedFor(seedsRef.current, id);
      const { seed, fixed } = own === null ? pickGalaxy() : { seed: own, fixed: undefined };
      const columns: Lod = devicePixelRatio * innerWidth >= 2400 ? 192 : 96;
      try {
        const render = await requestGalaxy(seed, columns, fixed, controller.signal);
        if (controller.signal.aborted) return;
        const layer = slot(id);
        draw(layer, render);
        const palette = loadPalette(render.palette.key);
        tints.set(id, css(palette.sample(0.55), 1));
        layer.style.setProperty('--scan', css(palette.accent, 0.9));
        state = galaxyReady(state, id);
        failures = 0;
      } catch (error) {
        // Another seed on the next frame, but give up after three failures in a row (the current galaxy stays).
        if ((error as { name?: string }).name !== 'AbortError' && ++failures < 3) requested = 0;
      }
    }

    function apply(now: number): void {
      const styles = layerStyles(state, now);
      layers.forEach((layer, index) => {
        const s = styles.find((l) => l.id % layers.length === index);
        layer.style.opacity = s ? String(s.opacity) : '0';
        if (!s) return;
        if (!reduced) {
          layer.style.transform = `rotate(${s.rotate.toFixed(3)}deg) scale(${s.scale.toFixed(4)})`;
          layer.style.filter = `brightness(${s.glow.toFixed(3)})`;
        }
        layer.style.setProperty('--reveal', `${(s.reveal * 100).toFixed(2)}%`);
        layer.dataset['scanning'] = s.reveal < 1 ? 'true' : 'false';
      });
      // The vignette takes the colour of the galaxy that is (becoming) the main one.
      const lead = state.phase === 'fading' ? state.incoming : state.shown;
      if (lead && lead !== tinted && tints.has(lead)) {
        tinted = lead;
        host!.style.setProperty('--tint', tints.get(lead)!);
      }
    }

    const frame = (t: number) => {
      const dt = Math.min(t - last, 100);
      last = t;
      if (document.visibilityState === 'visible') clock += dt;
      state = nextPhase(state, clock);
      if (state.incoming && state.incoming !== requested) void prepare(state.incoming);
      apply(clock);
      // Reduced motion: once the only galaxy is on screen there is nothing left to animate.
      if (reduced && state.phase === 'showing') return;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      controller.abort();
      cancelAnimationFrame(raf);
    };
  }, [reduced]);

  return (
    <div className="backdrop" aria-hidden="true" ref={root}>
      <div className="dust" />
      <div className="layer" ref={layerA}>
        <div className="scan" />
      </div>
      {reduced ? null : (
        <div className="layer" ref={layerB}>
          <div className="scan" />
        </div>
      )}
      <div className="vignette" />
    </div>
  );
}
