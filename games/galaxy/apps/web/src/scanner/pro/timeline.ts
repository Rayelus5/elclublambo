import type { gsap as Gsap } from 'gsap';
import { GUION, type Phase, type Script, type TrailTint } from './script';

// The pro scanner's choreography (plan «escáner pro», part B): one paused GSAP timeline built from the script. It moves
// no element itself: it tweens a plain «rig» of numbers — the letterbox, the jump, the trail's tint, the meteors, the
// shockwave, the flash, the shake, the camera and each card — and the 3D scene and the DOM overlays read the rig every
// frame. So seeking (Seguir, Saltar, the Ensayo's «ir a fase») is just `tl.time(t)`, the same picture forwards or back,
// and the tests read the numbers instead of pixels. Only transforms and opacities move on the page (GPU, 60 fps).

/** The letterbox once the cinema framing opens: each band is half the screen scaled by this (0.24 → 12 % each). */
export const CINEMA = 0.24;

/** Where a single card stands (world units; the card is 5 × 7 at scale 1). */
export const SINGLE = { x: 0, y: 0, z: 0, scale: 0.78 } as const;
/** A close-up in a ten: in front of the grid, a little bigger. */
export const SOLO = { x: 0, y: 0, z: 1, scale: 0.78 } as const;
/** The ten's grid: 5 × 2, rarest bottom right (slots go in reveal order). */
export const GRID = {
  scale: 0.36,
  x: (slot: number) => ((slot % 5) - 2) * 2.15,
  y: (slot: number) => (slot < 5 ? 1.42 : -1.42),
} as const;

/**
 * A fusion's ring (plan «fusión pro»): the galaxies going in sit on an ellipse round the core (`rx` × `ry` at ring 1,
 * the first on top), close in to `close` along the orbit while it turns `spin` radians, then sink into the core.
 */
export const RING = {
  rx: 3.3,
  ry: 1.75,
  close: 0.6,
  spin: 1.75 * Math.PI * 2,
  /** Five or fewer, a little bigger. */
  scale: (n: number) => (n > 6 ? 0.26 : 0.3),
  angle: (i: number, n: number) => (i / Math.max(1, n)) * Math.PI * 2 + Math.PI / 2,
} as const;

/** One of a fusion's galaxies going in. */
export interface InputRig {
  alpha: number;
  /** 0 on the ring … 1 sunk into the core. */
  absorb: number;
  /** Its edge lit with its tier (0–1). */
  glow: number;
}

export interface CardRig {
  x: number;
  y: number;
  z: number;
  scale: number;
  /** 0 face down … π face up. */
  rotY: number;
  rotZ: number;
  alpha: number;
  /** Its edge lit with its tier (0–1). */
  glow: number;
}

export interface Rig {
  /** Each letterbox band: 1 closes the screen, CINEMA frames it, 0 is gone. */
  bars: number;
  /** A black veil over the scene (1 at first; the summary dims it again). */
  black: number;
  /** The point of light the jump is born from. */
  ignite: number;
  /** 0 still stars … 1 full streaks. */
  warp: number;
  /** The camera's speed through the stars. */
  speed: number;
  /** The trail's tint: 0 ice, 1 the shown tier, 2 the real one. */
  trail: number;
  nebula: number;
  /** The shooting stars falling: 0 above … 1 landed. */
  meteor: number;
  /** The shockwave: 0 … 1 gone. */
  impact: number;
  flash: number;
  flashColor: 'white' | TrailTint;
  shake: number;
  /** The legendary's god rays. */
  rays: number;
  /** The grid dimmed behind a close-up. */
  dim: number;
  camZ: number;
  /** The card the texts speak about (its slot), -1 none. */
  focus: number;
  /** Its name typing in (0–1), its tier stamped (0–1), «Destacada» and its phenomenon. */
  title: number;
  stamp: number;
  featured: number;
  phenomenon: number;
  /** The summary fading in over the scene. */
  summary: number;
  cards: CardRig[];
  /** A fusion's ring: its size (1 round the core, smaller as it closes in) and how far it has turned (radians). */
  ring: number;
  spin: number;
  /** A fusion's core: its glow (0–1), tinted as the trail. */
  core: number;
  inputs: InputRig[];
}

const ABOVE = 6;

/** The rig at the very start (black, closed), with every card hidden above its place. */
export function createRig(s: Script): Rig {
  const ten = s.count > 1;
  const fusion = s.intro === 'fusion';
  return {
    bars: 1,
    black: 1,
    ignite: 0,
    warp: 0,
    speed: 0,
    trail: 0,
    nebula: 0,
    meteor: 0,
    impact: 0,
    flash: 0,
    flashColor: 'white',
    shake: 0,
    rays: 0,
    dim: 0,
    camZ: 0,
    focus: -1,
    title: 0,
    stamp: 0,
    featured: 0,
    phenomenon: 0,
    summary: 0,
    ring: fusion && !s.reduced ? 1.15 : 1,
    spin: 0,
    core: 0,
    inputs: s.inputs.map(() => ({ alpha: 0, absorb: 0, glow: 0 })),
    // A fusion's new card is born small in the core; a scan's falls from above its place.
    cards: Array.from({ length: s.count }, (_, slot) => ({
      x: ten ? GRID.x(slot) : SINGLE.x,
      y: (ten ? GRID.y(slot) : SINGLE.y) + (fusion ? 0 : ABOVE),
      z: fusion ? -1 : -3,
      scale: ten ? GRID.scale * 0.6 : SINGLE.scale * (fusion ? 0.05 : 0.6),
      rotY: 0,
      rotZ: 0,
      alpha: 0,
      glow: 0,
    })),
  };
}

type Timeline = gsap.core.Timeline;

/**
 * The texts of a card showing its face at `face`: its name typing, its tier stamped, «Destacada». All done by `until`
 * (the single card's wait stops the clock there, and nothing may freeze half-typed).
 */
function texts(tl: Timeline, rig: Rig, s: Script, slot: number, face: number, featured: boolean, until: number) {
  const room = Math.max(0.15, until - face - 0.02);
  tl.set(rig, { focus: slot }, face - 0.35);
  tl.fromTo(rig, { title: 0 }, { title: 1, duration: Math.min(0.55, room), ease: 'none', immediateRender: false }, face);
  tl.fromTo(rig, { stamp: 0 }, { stamp: 1, duration: Math.min(s.reduced ? 0.2 : 0.35, Math.max(0.1, room - 0.1)), ease: s.reduced ? 'power1.out' : 'back.out(2.2)', immediateRender: false }, Math.min(face + 0.1, until - 0.12));
  if (featured) tl.fromTo(rig, { featured: 0 }, { featured: 1, duration: 0.4, ease: 'back.out(1.8)', immediateRender: false }, face + 0.25);
}

function untexts(tl: Timeline, rig: Rig, at: number, dur: number) {
  tl.to(rig, { title: 0, stamp: 0, featured: 0, phenomenon: 0, duration: dur, ease: 'power2.in' }, at);
  tl.set(rig, { focus: -1 }, at + dur);
}

/** A paused timeline that plays the script on `rig`. */
export function buildTimeline(gsap: typeof Gsap, s: Script, rig: Rig): Timeline {
  const tl = gsap.timeline({ paused: true });
  const ten = s.count > 1;
  const fusion = s.intro === 'fusion';
  const T = GUION.ten;
  const F = GUION.fusion;
  // Where the ring stands when the orbit ends (a surge turns it further): the collapse goes on from there.
  let spun = RING.spin;
  const card = (slot: number) => rig.cards[slot]!;
  const tierOf = (p: Phase) => p.tier;
  const faceOf = (slot: number) => s.faces.find((f) => f.slot === slot)!;

  for (const p of s.phases) {
    tl.addLabel(p.label, p.at);
    const { at, dur } = p;
    switch (p.kind) {
      case 'ignicion':
        tl.to(rig, { bars: CINEMA, duration: dur * 0.8, ease: 'expo.inOut' }, at);
        tl.to(rig, { black: 0, duration: dur * 0.6, ease: 'power2.out' }, at + dur * 0.2);
        if (fusion) {
          // The galaxies going in appear round a dim core, one after another, as the ring settles.
          if (!s.reduced) tl.to(rig, { ring: 1, duration: dur * 0.8, ease: 'power2.out' }, at);
          tl.to(rig, { core: 0.3, duration: dur * 0.6, ease: 'power2.out' }, at + dur * 0.2);
          // Each fades in `stagger` after the last, all of them in before the ignition ends (a short calm one too).
          const fade = Math.min(0.3, dur * 0.4);
          const step = rig.inputs.length > 1 ? Math.min(F.stagger, (dur * 0.9 - 0.1 - fade) / (rig.inputs.length - 1)) : 0;
          rig.inputs.forEach((inp, i) => tl.to(inp, { alpha: 1, glow: 0.6, duration: fade, ease: 'power1.out' }, at + 0.1 + i * step));
        } else if (!s.reduced) tl.fromTo(rig, { ignite: 0 }, { ignite: 1, duration: dur * 0.5, ease: 'power4.out', immediateRender: false }, at);
        break;
      case 'orbita':
        // Faster and closer: the spin speeds up to the collapse (it carries on there at that pace).
        tl.to(rig, { spin: RING.spin, duration: dur, ease: 'power2.in' }, at);
        tl.to(rig, { ring: RING.close, duration: dur, ease: 'power1.in' }, at);
        tl.to(rig, { core: 0.75, speed: 0.12, duration: dur, ease: 'power1.in' }, at);
        tl.to(rig, { nebula: 1, duration: dur * 0.8, ease: 'power1.inOut' }, at);
        rig.inputs.forEach((inp) => tl.to(inp, { glow: 1, duration: dur * 0.3, ease: 'power2.in' }, at + dur * 0.7));
        if (s.trail.shown !== 'ice') tl.to(rig, { trail: 1, duration: 0.3, ease: 'power2.out' }, at + dur * GUION.trailShift);
        break;
      case 'salto':
        tl.to(rig, { warp: 1, speed: 1, duration: dur, ease: 'expo.in' }, at);
        tl.to(rig, { ignite: 0, duration: dur * 0.4, ease: 'power2.in' }, at);
        tl.to(rig, { nebula: 1, duration: dur * 0.8, ease: 'power1.inOut' }, at);
        if (s.trail.shown !== 'ice') tl.to(rig, { trail: 1, duration: 0.3, ease: 'power2.out' }, at + dur * GUION.trailShift);
        break;
      case 'ascenso':
        if (fusion) {
          // The ring seems to settle (it widens, the core dims), then the core breaks into the real colour.
          spun = RING.spin + Math.PI * 1.5;
          tl.to(rig, { spin: spun, duration: dur, ease: 'power1.inOut' }, at);
          tl.to(rig, { ring: RING.close + 0.12, core: 0.45, duration: dur * 0.5, ease: 'power2.out' }, at);
          tl.to(rig, { ring: RING.close, core: 1, duration: dur * 0.5, ease: 'expo.in' }, at + dur * 0.5);
          tl.to(rig, { trail: 2, duration: 0.18, ease: 'expo.out' }, at + dur * 0.6);
          break;
        }
        // It seems to end (the speed falls), then breaks into the real colour.
        tl.to(rig, { speed: 0.5, duration: dur * 0.5, ease: 'power2.out' }, at);
        tl.to(rig, { speed: 1.35, duration: dur * 0.25, ease: 'expo.in' }, at + dur * 0.5);
        tl.to(rig, { trail: 2, duration: 0.18, ease: 'expo.out' }, at + dur * 0.6);
        break;
      case 'colapso': {
        const n = rig.inputs.length;
        if (s.reduced) {
          // They fade into the core, which glows a moment and goes.
          rig.inputs.forEach((inp) => tl.to(inp, { alpha: 0, absorb: 1, duration: dur * 0.7, ease: 'power1.inOut' }, at));
          tl.to(rig, { core: 0.6, duration: dur * 0.5, ease: 'power1.out' }, at);
          tl.to(rig, { core: 0, duration: dur * 0.5, ease: 'power1.in' }, at + dur * 0.5);
          break;
        }
        // One by one into the core, still turning; the core swells with each and shrinks to a point for the burst.
        const sink = dur * 0.4;
        const gap = n > 1 ? (dur * 0.55) / (n - 1) : 0;
        rig.inputs.forEach((inp, i) => {
          tl.to(inp, { absorb: 1, duration: sink, ease: 'power2.in' }, at + i * gap);
          tl.to(inp, { alpha: 0, duration: sink * 0.35, ease: 'power1.in' }, at + i * gap + sink * 0.65);
        });
        tl.to(rig, { spin: spun + Math.PI * 3, duration: dur, ease: 'none' }, at);
        tl.to(rig, { ring: 0.35, duration: dur, ease: 'power1.in' }, at);
        tl.to(rig, { core: 1, duration: dur * 0.7, ease: 'power1.in' }, at);
        tl.to(rig, { core: 0.1, duration: dur * 0.3, ease: 'expo.in' }, at + dur * 0.7);
        tl.to(rig, { nebula: 0.35, speed: 0, duration: dur, ease: 'power1.out' }, at);
        break;
      }
      case 'caida':
        tl.to(rig, { warp: 0, speed: 0, duration: dur * 0.45, ease: 'expo.out' }, at);
        tl.fromTo(rig, { meteor: 0 }, { meteor: 1, duration: dur, ease: 'power1.in', immediateRender: false }, at);
        tl.to(rig, { nebula: 0.35, duration: dur, ease: 'power1.out' }, at);
        break;
      case 'impacto': {
        // The hit-stop first: nothing moves, then the shockwave rolls out past the end of the phase.
        const strike = at + (p.lead ?? 0);
        tl.fromTo(rig, { impact: 0 }, { impact: 1, duration: at + dur - strike + 0.9, ease: 'power2.out', immediateRender: false }, strike);
        // A fusion's core bursts.
        if (fusion) tl.to(rig, { core: 0, duration: 0.12, ease: 'power2.out' }, strike);
        break;
      }
      case 'carta': {
        const c = card(0);
        const face = faceOf(0).at;
        if (s.reduced) {
          tl.set(c, { x: SINGLE.x, y: SINGLE.y, z: SINGLE.z, rotY: Math.PI }, at);
          tl.fromTo(c, { alpha: 0, scale: SINGLE.scale * 0.92 }, { alpha: 1, scale: SINGLE.scale, duration: dur, ease: 'power1.out', immediateRender: false }, at);
        } else {
          tl.to(c, { alpha: 1, duration: 0.25, ease: 'power1.out' }, at);
          tl.to(c, { x: SINGLE.x, y: SINGLE.y, z: SINGLE.z, scale: SINGLE.scale, duration: dur * 0.55, ease: 'back.out(1.4)' }, at);
          tl.to(c, { rotY: Math.PI, duration: dur * 0.6, ease: 'power3.inOut' }, at + dur * 0.3);
          tl.to(c, { glow: 1, duration: 0.15, ease: 'power2.out' }, face);
          tl.to(c, { glow: 0.35, duration: 0.8, ease: 'power2.out' }, face + 0.15);
          if (tierOf(p) === 'legendary') tl.to(rig, { rays: 1, duration: 0.6, ease: 'power2.out' }, face - 0.3);
        }
        texts(tl, rig, s, 0, face, faceOf(0).featured, at + dur);
        break;
      }
      case 'fenomeno':
        tl.fromTo(rig, { phenomenon: 0 }, { phenomenon: 1, duration: 0.35, ease: s.reduced ? 'power1.out' : 'back.out(1.6)', immediateRender: false }, at);
        break;
      case 'reparto':
        rig.cards.forEach((c, slot) => {
          const d = s.reduced ? dur : Math.max(0.2, dur - 0.06 * (rig.cards.length - 1));
          if (s.reduced) {
            tl.set(c, { x: GRID.x(slot), y: GRID.y(slot), z: 0, scale: GRID.scale }, at);
            tl.to(c, { alpha: 1, duration: d, ease: 'power1.out' }, at);
          } else {
            tl.to(c, { alpha: 1, duration: 0.2, ease: 'power1.out' }, at + slot * 0.06);
            tl.to(c, { x: GRID.x(slot), y: GRID.y(slot), z: 0, scale: GRID.scale, rotZ: 0, duration: d, ease: 'power3.out' }, at + slot * 0.06);
          }
        });
        break;
      case 'giro': {
        const slot = p.slot!;
        const c = card(slot);
        const face = faceOf(slot).at;
        if (s.reduced) {
          tl.to(c, { alpha: 0.25, duration: 0.12, ease: 'power1.in' }, face - 0.12);
          tl.set(c, { rotY: Math.PI }, face);
          tl.to(c, { alpha: 1, glow: 0.35, duration: 0.18, ease: 'power1.out' }, face);
        } else {
          tl.to(c, { glow: 1, duration: T.aviso, ease: 'power2.out' }, at);
          tl.to(c, { rotY: Math.PI, duration: T.giro, ease: 'power2.inOut' }, at + T.aviso);
          tl.to(c, { z: 0.5, duration: T.giro / 2, ease: 'power2.out' }, at + T.aviso);
          tl.to(c, { z: 0, duration: T.giro / 2, ease: 'power2.in' }, at + T.aviso + T.giro / 2);
          tl.to(c, { glow: 0.35, duration: 0.5, ease: 'power2.out' }, at + T.aviso + T.giro);
        }
        break;
      }
      case 'solo': {
        const slot = p.slot!;
        const c = card(slot);
        const { at: face, featured, phenomenon } = faceOf(slot);
        const back = at + dur - T.solo.volver;
        tl.to(rig, { dim: 0.78, duration: T.solo.volar, ease: 'power2.out' }, at);
        tl.to(c, { x: SOLO.x, y: SOLO.y, z: SOLO.z, scale: SOLO.scale, glow: 1, duration: T.solo.volar, ease: 'power3.inOut' }, at);
        tl.to(c, { rotY: Math.PI, duration: T.solo.giro, ease: 'power3.inOut' }, at + T.solo.volar);
        if (tierOf(p) === 'legendary') {
          tl.to(rig, { rays: 1, duration: 0.6, ease: 'power2.out' }, face - 0.3);
          tl.to(rig, { rays: 0, duration: T.solo.volver, ease: 'power2.in' }, back);
        }
        texts(tl, rig, s, slot, face, featured, back);
        if (phenomenon) tl.fromTo(rig, { phenomenon: 0 }, { phenomenon: 1, duration: 0.35, ease: 'back.out(1.6)', immediateRender: false }, face + 0.4);
        tl.to(c, { x: GRID.x(slot), y: GRID.y(slot), z: 0, scale: GRID.scale, glow: 0.35, duration: T.solo.volver, ease: 'power3.inOut' }, back);
        tl.to(rig, { dim: 0, duration: T.solo.volver, ease: 'power2.in' }, back);
        untexts(tl, rig, back, T.solo.volver * 0.8);
        break;
      }
      case 'final':
        if (!s.reduced) tl.to(rig, { camZ: -0.6, duration: dur, ease: 'sine.inOut' }, at);
        break;
      case 'resumen':
        // The cards and the rays go: the summary shows the galaxies over a quiet sky.
        rig.cards.forEach((c) => tl.to(c, { alpha: 0, glow: 0, duration: dur * 0.8, ease: 'power2.in' }, at));
        tl.to(rig, { rays: 0, dim: 0, duration: dur * 0.6, ease: 'power2.in' }, at);
        tl.to(rig, { bars: 0, duration: dur, ease: 'expo.inOut' }, at);
        tl.to(rig, { summary: 1, duration: dur, ease: 'power2.out' }, at);
        tl.to(rig, { black: 0.86, duration: dur, ease: 'power1.inOut' }, at);
        if (!ten) untexts(tl, rig, at, dur * 0.6);
        break;
      default:
        break;
    }
  }

  // The lights and the camera's jolts, from the script (never under reduced motion: the script has none then).
  for (const f of s.flashes) {
    tl.set(rig, { flashColor: f.color }, f.at);
    tl.fromTo(rig, { flash: 0 }, { flash: f.alpha, duration: 0.05, ease: 'none', immediateRender: false }, f.at);
    tl.to(rig, { flash: 0, duration: 0.45, ease: 'power2.out' }, f.at + 0.05);
  }
  for (const k of s.shakes) tl.fromTo(rig, { shake: k.amp }, { shake: 0, duration: k.dur, ease: 'power2.out', immediateRender: false }, k.at);
  // The timeline reaches the end of the summary even where nothing moves then.
  tl.set({}, {}, s.duration);
  return tl;
}
