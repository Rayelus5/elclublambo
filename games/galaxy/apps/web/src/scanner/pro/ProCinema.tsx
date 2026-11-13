import type { PulledGalaxy, Tier } from '@galaxy/shared';
import { gsap } from 'gsap';
import { type MutableRefObject, useEffect, useLayoutEffect, useRef } from 'react';
import { createScore } from '../../audio/score';
import { copy } from '../../copy/es';
import { composeInto } from '../../galaxy/compose';
import { loadRender } from '../../galaxy/images';
import { audioTime, createClock } from './clock';
import type { CueOpts, ProSound } from './cues';
import { composeCardFace, drawCardBack } from './faces';
import { createPlayer, type Player } from './player';
import { createProScene, type ProScene } from './scene';
import { buildScript, type Face, type Intro, type Phase, type PhaseKind, type Script, type TrailTint } from './script';
import { proAudio, proStems } from './sounds';
import { buildTimeline, createRig, type Rig } from './timeline';

// The pro scanner's cinema (plan «escáner pro», part B), in its own chunk with GSAP and three.js: it builds the script
// from the pulls, the rig and its timeline, the 3D scene and the player, composes each card's face as its galaxy
// arrives, loads the sounds and the music, and paints the overlays the shell owns (the bands, the flash, the
// captions) through CSS variables, once a frame, without React re-rendering. The shell keeps everything a screen
// reader or a click needs; this only draws and plays.

/** The overlay elements the shell renders and this paints. */
export interface ProOverlay {
  root: HTMLElement;
  caption: HTMLElement;
  name: HTMLElement;
  tier: HTMLElement;
  phenomenon: HTMLElement;
}

/** What the shell (and the Ensayo) can ask of a playing cinema. */
export interface CinemaControl {
  advance(): boolean;
  skip(): boolean;
  seek(t: number): void;
  setRate(rate: number): void;
  pause(): void;
  resume(): void;
  readonly script: Script;
  time(): number;
}

export interface ProCinemaProps {
  pulls: readonly PulledGalaxy[];
  /** A scan (the default) or a fusion, with the galaxies going in (plan «fusión pro»). */
  intro?: Intro;
  inputs?: readonly PulledGalaxy[];
  reduced: boolean;
  overlay: MutableRefObject<ProOverlay | null>;
  control: MutableRefObject<CinemaControl | null>;
  onPhase: (p: Phase) => void;
  onFace: (f: Face, g: PulledGalaxy) => void;
  onWait: (waiting: boolean) => void;
  /** The WebGL context was lost: the shell shows the summary. */
  onLost: () => void;
  /** The cinema is playing and can be directed (the Ensayo's panel). */
  onReady?: (control: CinemaControl) => void;
  /** The Ensayo's direction: durations, the surge, the speed. */
  overrides?: Readonly<Partial<Record<PhaseKind, number>>>;
  surge?: boolean;
  rate?: number;
}

const TINTS: TrailTint[] = ['ice', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const IMAGE_PX = 640;
/** A fusion's galaxies going in are drawn some 150 px wide. */
const INPUT_FACE_PX = 240;
const INPUT_IMAGE_PX = 192;

/** Each tint as a hex from the design tokens (the colour-blind palettes override them). */
function tokenColors(): Record<TrailTint, string> {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => {
    const v = style.getPropertyValue(name).trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
  };
  const fallback: Record<TrailTint, string> = { ice: '#bfe3ff', common: '#c9d0ea', uncommon: '#45e3a6', rare: '#6fb7ff', epic: '#b39dff', legendary: '#ffc94a', mythic: '#ff4fd8' };
  return Object.fromEntries(TINTS.map((k) => [k, read(k === 'ice' ? '--color-ice' : `--color-tier-${k}`, fallback[k])])) as Record<TrailTint, string>;
}

const PIPS: Record<Tier, number> = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, mythic: 6 };

export default function ProCinema(props: ProCinemaProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  // The callbacks and the overlay as the shell has them now (read by the frame loop, never during render).
  useLayoutEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const p = latest.current;
    const pulls = p.pulls;
    const inputs = p.intro === 'fusion' ? (p.inputs ?? []) : [];
    const script = buildScript(pulls, { motion: p.reduced ? 'reduced' : 'full', surge: p.surge, overrides: p.overrides, intro: p.intro, inputs: inputs.map((g) => g.tier) });
    const rig: Rig = createRig(script);
    const timeline = buildTimeline(gsap, script, rig);
    const canvas = document.createElement('canvas');
    canvas.className = 'pro-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    el.append(canvas);
    const controller = new AbortController();
    const ready = new Set<number>();
    const slots = script.order.map((index) => pulls[index]!);

    let scene: ProScene | null = null;
    try {
      scene = createProScene(canvas, {
        script,
        cards: slots.map((g) => ({ galaxy: g, front: composeCardFace(g, null) })),
        // The ring's cards are small on screen: small faces, quick to make and to upload.
        inputs: inputs.map((g) => ({ galaxy: g, front: composeCardFace(g, null, INPUT_FACE_PX) })),
        back: drawCardBack(),
        colors: tokenColors(),
        reduced: p.reduced,
        onLost: () => latest.current.onLost(),
      });
    } catch {
      // No WebGL after all: the summary instead (nothing is lost, the galaxies are already the player's).
      canvas.remove();
      queueMicrotask(() => latest.current.onLost());
      return;
    }
    const fit = () => scene?.resize(el.clientWidth || window.innerWidth, el.clientHeight || window.innerHeight);
    fit();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    ro?.observe(el);

    // Each card's face as its galaxy arrives (cache, then the Worker), in the order they turn.
    void (async () => {
      await document.fonts?.ready;
      slots.forEach((g, slot) => {
        loadRender(BigInt(g.seed), 96, controller.signal).then(
          (render) => {
            if (controller.signal.aborted) return;
            const image = document.createElement('canvas');
            const ok = composeInto(image, render, IMAGE_PX);
            scene?.setFront(slot, composeCardFace(g, ok ? image : null));
            ready.add(slot);
          },
          () => ready.add(slot),
        );
      });
      // A fusion's galaxies going in (the collection has them cached): the ring never waits for them.
      inputs.forEach((g, i) => {
        loadRender(BigInt(g.seed), 96, controller.signal).then(
          (render) => {
            if (controller.signal.aborted) return;
            const image = document.createElement('canvas');
            if (composeInto(image, render, INPUT_IMAGE_PX)) scene?.setInputFront(i, composeCardFace(g, image, INPUT_FACE_PX));
          },
          () => {},
        );
      });
    })();

    // Sound: the bank on the effects bus, the music on its own bus under the music bus.
    const audio = proAudio();
    const clock = createClock(() => audioTime(audio?.ctx ?? null));
    const player: Player = createPlayer({
      script,
      rig,
      timeline,
      clock,
      scene,
      audio: audio ? { ctx: audio.ctx, sfx: audio.sfx, music: audio.music } : null,
      bank: audio?.bank ?? null,
      ready: (slot) => ready.has(slot),
      paint: paintOverlay(latest, slots),
      onPhase: (ph) => latest.current.onPhase(ph),
      onFace: (f) => latest.current.onFace(f, pulls[f.index]!),
      onWait: (w) => latest.current.onWait(w),
    });
    if (audio) {
      const tiers = [...new Set(pulls.map((g) => g.tier))];
      const ids = [...new Set(script.cues.map((c) => c.id))] as ProSound[];
      void audio.bank.preload(ids, tiers.map((tier): CueOpts => ({ tier })));
      void proStems(audio.ctx).then((layers) => {
        if (!layers || controller.signal.aborted || !player.scoreOut) return;
        player.setScore(createScore(audio.ctx, player.scoreOut, layers));
      });
    }
    if (p.rate && p.rate !== 1) player.setRate(p.rate);
    const control: CinemaControl = {
      advance: () => player.advance(),
      skip: () => player.skip(),
      seek: (t) => player.seek(t),
      setRate: (r) => player.setRate(r),
      pause: () => player.pause(),
      resume: () => player.resume(),
      script,
      time: () => player.time,
    };
    latest.current.control.current = control;
    latest.current.onReady?.(control);
    player.start();

    // A hidden tab pauses everything (and the music hushes); back, it carries on.
    const onVisibility = () => (document.hidden ? player.pause() : player.resume());
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      controller.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      ro?.disconnect();
      player.stop();
      timeline.kill();
      scene?.dispose();
      canvas.remove();
      latest.current.control.current = null;
    };
  }, []);

  return <div ref={host} className="pro-canvas-host" />;
}

/** Writes the rig into the shell's overlays: CSS variables on its root, and the caption's texts when they change. */
function paintOverlay(latest: MutableRefObject<ProCinemaProps>, slots: readonly PulledGalaxy[]) {
  let focus = -2;
  let typed = -1;
  return (rig: Rig) => {
    const o = latest.current.overlay.current;
    if (!o) return;
    const style = o.root.style;
    style.setProperty('--bars', rig.bars.toFixed(4));
    style.setProperty('--black', rig.black.toFixed(4));
    style.setProperty('--flash', rig.flash.toFixed(4));
    style.setProperty('--stamp', rig.stamp.toFixed(4));
    style.setProperty('--featured', rig.featured.toFixed(4));
    style.setProperty('--phen', rig.phenomenon.toFixed(4));
    style.setProperty('--summary', rig.summary.toFixed(4));
    if (o.root.dataset['flash'] !== rig.flashColor) o.root.dataset['flash'] = rig.flashColor;
    const g = rig.focus >= 0 ? slots[rig.focus] : undefined;
    if (rig.focus !== focus) {
      focus = rig.focus;
      typed = -1;
      if (g) {
        o.caption.dataset['tier'] = g.tier;
        o.caption.dataset['pips'] = String(PIPS[g.tier]);
        o.tier.textContent = copy.tiers[g.tier];
        o.tier.setAttribute('aria-label', `${copy.tiers[g.tier]}. ${copy.scanner.pips(PIPS[g.tier])}`);
        const ph = g.traits['phenomenon'];
        o.phenomenon.textContent = ph && ph !== 'none' ? ((copy.traitValues.phenomenon as Record<string, string>)[ph] ?? ph) : '';
        o.root.dataset['featured'] = g.featured ? 'true' : 'false';
      } else {
        delete o.caption.dataset['tier'];
        o.name.textContent = '';
        o.tier.textContent = '';
      }
    }
    if (g) {
      const n = Math.round(rig.title * g.name.length);
      if (n !== typed) {
        typed = n;
        o.name.textContent = g.name.slice(0, n);
      }
    }
  };
}
