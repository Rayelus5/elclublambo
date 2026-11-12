import 'pixi.js/unsafe-eval';
import { AREA, type BiomeId, type Content, ELEMENT_IDS, SHOT, type Sim, type SimEvent } from '@galaxy/sim';
import { Application, BitmapFont, BitmapText, BlurFilter, Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import { copy } from '../../copy/es';
import { probeHeading, probeView } from '../sprites/rotate';
import { BAYER, buildAtlas, ditherTexture, fbm } from './atlas';
import { baseZoom, type Camera, cameraFor, zoomSteps } from './camera';
import { createFx, reactionLabel } from './fx';
import { stagePalette, type StagePalette } from './palette';
import type { ColorVisionMode } from '../../a11y/color-vision';
import { BIOME_LOOK } from './biomes';
import { CHUNK, terrainAt } from './terrain';
import { mateMarkers } from './mates';
import { type Insets, NO_INSETS } from './edge';
import { type Warning, warningFrom, warningProgress } from './warnings';
import { drawCoreBeam, drawCoreWarning, isCoreWarning } from './core-attacks';

// The arena renderer (GDD §18.4, DESIGN_SYSTEM §8 quater): PixiJS only draws the simulation. It interpolates between
// ticks, follows the probe with a pixel-snapped camera capped at 21:9, and adds the juice: hit flashes, numbers,
// particles, shake, the Static's glitch on elites and the boss, warnings before every strike and the beacon.

export interface StageOptions {
  reduced: boolean;
  /** Extra view from a starfield relic (camera only). */
  vision: number;
  /** The probe the camera follows. */
  probe: number;
  /** My own probe (co-op; default `probe`): only its hits flash and shake the screen, even while watching another. */
  me?: number;
  /** The run seed (decoration). */
  seed: string;
  /** Keep the drawing buffer (screenshots in tests). */
  preserve?: boolean;
  /** The sector's biome: its nebula, stars, dust and rocks (default: the M3a nebula). */
  biome?: BiomeId;
  /** Co-op (multiplayer plan): every player's name by probe, shown over the teammates. */
  names?: string[];
  /** Whole steps closer than the base view the run starts at (the player's wheel, kept between runs). */
  zoom?: number;
  /** The colour-blind palette (plan «escáner pro», part C). */
  colorVision?: ColorVisionMode;
}

export interface Stage {
  readonly app: Application;
  render(sim: Sim, alpha: number): void;
  /** The events of one simulation step (call once per step, in order), with its tick (default: the last drawn). */
  feed(events: readonly SimEvent[], tick?: number): void;
  resize(w: number, h: number): void;
  camera(): Camera | null;
  /** The mouse wheel: `steps` whole steps closer (negative: farther), within the camera's limits; it glides there. */
  zoom(steps: number): void;
  /** How many steps closer than the base view it is set to now. */
  zoomLevel(): number;
  /** Follows another probe from now on (the admin's replay of a group run switches between players). */
  follow(probe: number): void;
  /** Co-op: the screen bands the HUD covers; the teammates' arrows keep out of them (Nov plan A2 review). */
  setInsets(insets: Insets): void;
  /** Ajustes → Movimiento changed while playing (plan «escáner pro», part A): applies from the next frame. */
  setReduced(on: boolean): void;
  /** Ajustes → Visión del color changed while playing (part C): applies from the next frame. */
  setColorVision(mode: ColorVisionMode): void;
  destroy(): void;
}

/**
 * Sprite per shot kind (systems/weapons.ts SHOT). Drawn otherwise: the beam and the lighthouse's beam (lines), a body
 * the sling threw (the enemy itself, in a grip of gravity) and a hologram (its probe's own drawing).
 */
const SHOT_SPRITE = [
  'bolt',
  'lance',
  'arc',
  'drone-bolt',
  'orb',
  'drone',
  'relic-ray',
  'jet',
  'quasar',
  'chaos',
  'reflected',
  'blade',
  'bolt',
  'missile',
  'shard',
  'mine',
  'disc',
  'turret',
  'split-shard',
  'harpoon',
  'bolt',
  'bolt',
  'bolt',
  'mortar-shell',
];
const ROTATES = new Set<number>([SHOT.bolt, SHOT.lance, SHOT.ray, SHOT.jet, SHOT.quasar, SHOT.missile, SHOT.shard, SHOT.split, SHOT.turret, SHOT.harpoon]);
/** The November arsenal's light (Nov plan B3): the lighthouse's warm beam, the hologram's cyan, the sling's lilac. */
const PHOTON = 0xffc94a;
const HOLO = 0x6fe3ff;
const GRAVITY = 0xb39dff;
const KILL_COLOR: Record<string, number> = { mite: 0xff4d6d, cell: 0xb39dff, cellet: 0xb39dff, ray: 0x6fb7ff, spitter: 0xff9a3c, shell: 0xb9bfe6 };
const STEP_RAD = (Math.PI * 2) / 4096;
/** Sprite per pickup kind after the data fragments (world/pools.ts PICKUP). */
const PICKUP_SPRITE: Record<number, string> = { 1: 'coin', 2: 'dust', 3: 'repair', 4: 'magnet', 5: 'component' };
/** A quirk's jump glides over this long; afterimages fade over GHOST_LIFE. */
const GLIDE_S = 0.12;
const GHOST_LIFE = 0.28;
const DASH_TINT = 0x6fe3ff;
const FONT = 'gs-dmg';
/** Reaction names: letters with Spanish accents. */
const LABEL_FONT = 'gs-react';
/** Each co-op player's colour, by probe (solar, terminal, ice, nova); the colour-blind modes swap it (palette.ts). */
export const TEAM_TINT = [0xffc94a, 0x45e3a6, 0xbfe3ff, 0xff6b7a];

/** Sprites kept per slot of a pool, made on demand and hidden when the slot is free. */
class SpritePool {
  readonly list: (Sprite | undefined)[] = [];
  constructor(private readonly layer: Container) {}
  at(i: number): Sprite {
    let s = this.list[i];
    if (!s) {
      s = new Sprite();
      this.list[i] = s;
      this.layer.addChild(s);
    }
    s.visible = true;
    return s;
  }
  hideFrom(alive: Uint8Array, top: number): void {
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i];
      if (s && (i >= top || !alive[i])) s.visible = false;
    }
  }
}

/**
 * An open arc as its own stroke: the pen moves to its start first. Without it PixiJS joins the arc to the last point
 * drawn on that Graphics (another area, another enemy), and a long line shoots across the arena.
 */
export function arcFrom<G extends Pick<Graphics, 'moveTo' | 'arc'>>(g: G, x: number, y: number, r: number, from: number, to: number): G {
  g.moveTo(x + Math.cos(from) * r, y + Math.sin(from) * r).arc(x, y, r, from, to);
  return g;
}

/** An arc drawn in dashes (a downed teammate's countdown: shape, not only colour, tells it from the revive). */
function dashedArc(g: Graphics, x: number, y: number, r: number, from: number, to: number, style: { width: number; color: number; alpha: number }): void {
  const dash = 0.42;
  const gap = 0.26;
  for (let a = from; a < to; a += dash + gap) arcFrom(g, x, y, r, a, Math.min(to, a + dash)).stroke(style);
}

/**
 * The backdrop steps back so what is played reads first: the starfield and the nebula are softly blurred, and a dark
 * veil over them lowers their light. Probes, enemies, loot, rocks and the ground's dust stay sharp above it.
 */
const BACKDROP_BLUR = 0.6;
const VEIL = { color: 0x03040e, alpha: 0.28 };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export async function createStage(canvas: HTMLCanvasElement, content: Content, given: StageOptions): Promise<Stage> {
  // Its own copy: some options change while playing (setReduced), and the caller's object stays as it was.
  const opts: StageOptions = { ...given };
  // The meaningful colours (danger, good, the players, the elements), swapped live by Ajustes → Visión del color.
  let pal: StagePalette = stagePalette(opts.colorVision ?? 'none');
  const app = new Application();
  await app.init({
    canvas,
    width: canvas.clientWidth || canvas.width || 1280,
    height: canvas.clientHeight || canvas.height || 720,
    background: '#070a1c',
    antialias: false,
    resolution: 1,
    roundPixels: true,
    preference: 'webgl',
    preserveDrawingBuffer: opts.preserve ?? false,
    autoStart: false,
    sharedTicker: false,
  });
  app.stage.eventMode = 'none';
  // The page's CSS owns the canvas's cursor (the game's sight, ui/cursor.ts): Pixi would write `cursor: inherit` on it.
  app.renderer.events.cursorStyles.default = '';
  try {
    await document.fonts?.load('700 16px Fredoka');
  } catch {
    // The numbers fall back to the system font.
  }
  BitmapFont.install({
    name: FONT,
    style: { fontFamily: 'Fredoka, system-ui, sans-serif', fontSize: 18, fontWeight: '700', fill: '#ffffff', stroke: { color: '#0b0c24', width: 4 } },
    chars: [['0', '9']],
    resolution: 1,
  });
  BitmapFont.install({
    name: LABEL_FONT,
    style: { fontFamily: 'Fredoka, system-ui, sans-serif', fontSize: 15, fontWeight: '700', fill: '#ffffff', stroke: { color: '#0b0c24', width: 4 } },
    chars: [['a', 'z'], ['A', 'Z'], ['0', '9'], 'áéíóúÁÉÍÓÚñÑüÜ _-'],
    resolution: 1,
  });

  const atlas = buildAtlas();
  const look = BIOME_LOOK[opts.biome ?? 'nebula'];
  let w = app.renderer.width;
  let h = app.renderer.height;

  // Ground (screen space, at the camera's zoom): a sparse starfield in three brightnesses over the void, and a slow
  // nebula of seamless noise, dithered in deep violet and blue at very low contrast so sprites always pop.
  const starTex = ditherTexture(256, 256, (x, y) => {
    const r = ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0) % 10000;
    if (r < 6) return look.stars[0];
    if (r < 20) return look.stars[1];
    if (r < 46) return look.stars[2];
    return null;
  });
  const nebulaTex = ditherTexture(512, 512, (x, y) => {
    // Domain-warped noise: no visible lattice when it tiles.
    const wx = x + (fbm(x, y, 512, 91) - 0.5) * 140;
    const wy = y + (fbm(x + 37, y + 11, 512, 92) - 0.5) * 140;
    const n = fbm(wx, wy, 512, 7);
    const t = BAYER[(y % 4) * 4 + (x % 4)]! / 16;
    if (n > 0.66 && t < (n - 0.66) * 4) return look.nebula[0];
    if (n > 0.56 && t < (n - 0.56) * 3) return look.nebula[1];
    if (n < 0.3 && t < (0.3 - n) * 2) return look.nebula[2];
    return null;
  });
  const ground = new TilingSprite({ texture: starTex, width: w, height: h });
  const nebula = new TilingSprite({ texture: nebulaTex, width: w, height: h });
  const backdrop = new Container({ label: 'backdrop' });
  backdrop.addChild(nebula, ground);
  backdrop.filters = [new BlurFilter({ strength: BACKDROP_BLUR, quality: 2 })];
  const veil = new Graphics({ label: 'veil' });
  const paintVeil = () => veil.clear().rect(0, 0, w, h).fill(VEIL);
  paintVeil();
  const world = new Container({ label: 'world' });
  const decor = new Container();
  // Breakable props (SIM 1.7.0) over the ground, with their life bars and glints.
  const propLayer = new Container();
  const propMarks = new Graphics();
  const pickups = new Container();
  const areas = new Graphics();
  // Light that adds up (beams, flames, blasts): glows on the dark field instead of muddying it.
  const beams = new Graphics();
  beams.blendMode = 'add';
  const warnings = new Graphics();
  const marks = new Graphics();
  const enemies = new Container({ label: 'enemies' });
  const probes = new Container();
  // A dash's afterimages, under the probes.
  const ghostLayer = new Container();
  const shots = new Container();
  const particles = new Container();
  world.addChild(decor, propLayer, propMarks, pickups, areas, warnings, marks, enemies, ghostLayer, probes, beams, shots, particles);
  const numbers = new Container();
  // Co-op: arrows at the field's edge towards teammates off screen (Nov plan A2), under the labels.
  const mateArrows = new Graphics();
  numbers.addChild(mateArrows);
  const bars = new Graphics();
  const hurtFlash = new Graphics();
  app.stage.addChild(backdrop, veil, world, numbers, bars, hurtFlash);

  const enemyPool = new SpritePool(enemies);
  const glitchA = new SpritePool(enemies);
  const glitchB = new SpritePool(enemies);
  const pickupPool = new SpritePool(pickups);
  const propPool = new SpritePool(propLayer);
  const ghostSprites: Sprite[] = [];
  /** Dashes being drawn: a quirk's jump glides from where it took off; every dash leaves afterimages. */
  const glides = new Map<number, { fx: number; fy: number; tx: number; ty: number; t0: number; dur: number }>();
  const ghosts: { x: number; y: number; at: number; life: number; id: string; flip: number; tint: number }[] = [];
  const shotPool = new SpritePool(shots);
  const foePool = new SpritePool(shots);
  const probePool = new SpritePool(probes);
  const particleSprites: Sprite[] = [];
  const numberTexts: BitmapText[] = [];
  const labelTexts: BitmapText[] = [];
  const tagTexts: BitmapText[] = [];
  const mateTexts: BitmapText[] = [];
  let markerInsets: Insets = NO_INSETS;
  /** Where the teammates were drawn this frame (their names go over them). */
  const tagAt: { i: number; x: number; y: number }[] = [];
  const pipPool = new SpritePool(enemies);
  const starA = new SpritePool(enemies);
  const starB = new SpritePool(enemies);
  let lastProbe = { x: 0, y: 0 };
  let lastSim: Sim | null = null;

  const dustDots = [0, 1, 2, 3, 4, 5].map((v) =>
    ditherTexture(3, 4, (x, y) => (((v + 1) >> (x + y * 2)) & 1 && (x === 0 || x === 2) ? look.dust : null)),
  );
  const chunks = new Map<string, Container>();

  const fx = createFx(opts.reduced);
  const warns: Warning[] = [];
  /** The simulation tick of the last frame drawn (feeds without a tick use it). */
  let lastTick = 0;
  // The simulation's last new tick and when it came: the thrusters only fire while it advances (not paused).
  let seenTick = -1;
  let tickAt = 0;
  let frameDt = 0;
  let hurtAlpha = 0;
  /** A teammate just hit: its sprite turns red until this clock time (my own hits flash the screen instead). */
  const hurtBlink = new Map<number, number>();
  let last = performance.now();
  let clock = 0;
  let cam: Camera | null = null;
  // The player's zoom: the steps asked for, and the value drawn now (it glides there in a few frames).
  let closer = Math.max(0, Math.round(opts.zoom ?? 0));
  let shownCloser = closer;
  const clampCloser = () => {
    closer = Math.min(Math.max(0, closer), zoomSteps(baseZoom(h, opts.vision)));
  };

  function enemySprite(sim: Sim, i: number): string {
    const t = sim.enemies.type[i]!;
    return sim.enemies.boss[i] ? (content.bosses[t]?.sprite ?? 'hive') : (content.enemies[t]?.sprite ?? 'mite');
  }

  function frameOf(id: string, offset = 0): number {
    const def = atlas.defs[id];
    if (!def || def.fps === 0) return 0;
    return Math.floor(clock * def.fps + offset) % def.frames.length;
  }

  function syncChunks(c: Camera): void {
    const x0 = Math.floor((c.x - c.worldW / 2) / CHUNK) - 1;
    const x1 = Math.floor((c.x + c.worldW / 2) / CHUNK) + 1;
    const y0 = Math.floor((c.y - c.worldH / 2) / CHUNK) - 1;
    const y1 = Math.floor((c.y + c.worldH / 2) / CHUNK) + 1;
    const keep = new Set<string>();
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = cx + ':' + cy;
        keep.add(key);
        if (chunks.has(key)) continue;
        const box = new Container();
        for (const d of terrainAt(cx, cy, opts.seed, opts.biome)) {
          // Clouds live in the nebula layer; rocks are the sim's breakable props now (drawProps). The chunks carry only
          // the braille dust, faint so nothing on the ground looks like something to pick up or break.
          if (d.kind !== 'dust') continue;
          const s = new Sprite(dustDots[d.variant]!);
          s.anchor.set(0.5);
          s.position.set(Math.round(d.x), Math.round(d.y));
          s.scale.set(d.scale);
          s.alpha = 0.32;
          box.addChild(s);
        }
        chunks.set(key, box);
        decor.addChild(box);
      }
    }
    for (const [key, box] of chunks) {
      if (keep.has(key)) continue;
      box.destroy({ children: true });
      chunks.delete(key);
    }
  }

  function drawAreas(sim: Sim): void {
    const a = sim.areas;
    areas.clear();
    beams.clear();
    for (let i = 0; i < a.top; i++) {
      if (!a.alive[i]) continue;
      const x = a.x[i]!;
      const y = a.y[i]!;
      const r = a.radius[i]!;
      const kind = a.kind[i]!;
      const t = a.ttl[i]!;
      if (kind === AREA.nova) {
        const k = Math.max(0, Math.min(1, t / 18));
        areas.circle(x, y, r * (1 - k * 0.25)).stroke({ width: 2, color: 0xbfe3ff, alpha: k });
      } else if (kind === AREA.supernova) {
        const k = Math.max(0, Math.min(1, t / 24));
        areas.circle(x, y, r * (1 - k * 0.2)).stroke({ width: 3, color: 0xffc94a, alpha: k });
        areas.circle(x, y, r * (1 - k * 0.2)).fill({ color: 0xffc94a, alpha: k * 0.08 });
      } else if (kind === AREA.pulsar) {
        const k = Math.max(0, Math.min(1, t / 16));
        areas.circle(x, y, r * (1 - k * 0.3)).stroke({ width: 2, color: 0x6fe3ff, alpha: k });
      } else if (kind === AREA.trail) {
        const fade = Math.min(1, t / 30);
        areas.circle(x, y, r).fill({ color: 0x7259ee, alpha: 0.12 * fade }).stroke({ width: 1, color: 0xb39dff, alpha: 0.3 * fade });
      } else if (kind === AREA.cone) {
        // A flamethrower: a warm wedge with a hotter, flickering tongue inside.
        const mid = a.angle[i]! * STEP_RAD;
        const half = (a.arc[i]! * STEP_RAD) / 2;
        const flick = opts.reduced ? 0.75 : 0.65 + 0.2 * Math.sin(clock * 40 + i);
        beams.moveTo(x, y).arc(x, y, r, mid - half, mid + half).closePath().fill({ color: 0xff6a1a, alpha: 0.06 }).stroke({ width: 1, color: 0xff9a3c, alpha: 0.35 });
        // Tongues of flame of different lengths, flickering out of phase.
        for (let k = -2; k <= 2; k++) {
          const ta = mid + k * half * 0.38;
          const len = r * (opts.reduced ? 0.8 : 0.5 + 0.45 * Math.abs(Math.sin(clock * 9 + k * 1.7 + i)));
          const tw = half * 0.22;
          beams.moveTo(x, y).arc(x, y, len, ta - tw, ta + tw).closePath().fill({ color: 0xff9a3c, alpha: 0.2 });
        }
        beams.moveTo(x, y).arc(x, y, r * flick * 0.6, mid - half * 0.45, mid + half * 0.45).closePath().fill({ color: 0xffc94a, alpha: 0.26 });
        beams.moveTo(x, y).arc(x, y, r * flick * 0.3, mid - half * 0.25, mid + half * 0.25).closePath().fill({ color: 0xfff0c0, alpha: 0.3 });
      } else if (kind === AREA.field) {
        // A gravity well: a deep violet disc with arcs spiralling in.
        areas.circle(x, y, r).fill({ color: 0x3a2a9a, alpha: 0.2 }).stroke({ width: 1, color: 0x7259ee, alpha: 0.6 });
        for (let k = 0; k < 3; k++) {
          const a0 = (opts.reduced ? 0 : clock * 2.4) + (k * Math.PI * 2) / 3;
          arcFrom(areas, x, y, r * (0.35 + 0.2 * k), a0, a0 + 1.6).stroke({ width: 2, color: 0xb39dff, alpha: 0.55 });
        }
        areas.circle(x, y, 3).fill({ color: 0x0b0c24, alpha: 0.9 });
      } else if (kind === AREA.strike) {
        // The orbital strike's warning: a red reticle that tightens until the blast.
        const k = opts.reduced ? 1 : 0.85 + 0.15 * Math.sin(clock * 20);
        areas.circle(x, y, r * k).stroke({ width: 1, color: 0xff4d6d, alpha: 0.9 });
        areas.circle(x, y, r * 0.35).fill({ color: 0xff4d6d, alpha: 0.18 });
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          areas.moveTo(x + dx * r * 0.55, y + dy * r * 0.55).lineTo(x + dx * r * 1.15, y + dy * r * 1.15).stroke({ width: 2, color: 0xff6b7a, alpha: 0.9 });
        }
      } else if (kind === AREA.blast) {
        const k = Math.max(0, Math.min(1, t / 12));
        beams.circle(x, y, r * (1.1 - 0.4 * k)).fill({ color: 0xffc94a, alpha: 0.18 * k }).stroke({ width: 2, color: 0xff9a3c, alpha: k });
      } else if (kind === AREA.bomblet) {
        // A cluster bomblet (Nov plan B3): a small charge whose ring closes in, blinking faster just before it blows.
        const k = Math.max(0, Math.min(1, t / 30));
        const blink = opts.reduced ? 0.8 : t < 12 ? (Math.sin(clock * 40) > 0 ? 1 : 0.3) : 0.6 + 0.3 * Math.sin(clock * 14);
        areas.circle(x, y, r).stroke({ width: 1, color: 0xff9a3c, alpha: 0.5 });
        areas.circle(x, y, Math.max(1, r * k)).stroke({ width: 1, color: 0xffc94a, alpha: 0.85 });
        areas.rect(x - 1, y - 1, 2, 2).fill({ color: 0xffc94a, alpha: blink });
      } else if (kind === AREA.slowField) {
        areas.circle(x, y, r).fill({ color: 0x6fb7ff, alpha: 0.12 }).stroke({ width: 1, color: 0x6fb7ff, alpha: 0.5 });
      } else if (kind === AREA.aura) {
        const arc = a.arc[i]!;
        if (arc > 0) {
          const mid = a.angle[i]! * STEP_RAD;
          const half = (arc * STEP_RAD) / 2;
          areas.moveTo(x, y).arc(x, y, r, mid - half, mid + half).closePath().fill({ color: pal.good, alpha: 0.12 }).stroke({ width: 1, color: pal.good, alpha: 0.4 });
        } else {
          areas.circle(x, y, r).fill({ color: pal.good, alpha: 0.08 }).stroke({ width: 1, color: pal.good, alpha: 0.35 });
        }
      }
    }
    // Evolution rings around the probe.
    for (const ring of fx.rings) areas.circle(ring.x, ring.y, ring.radius).stroke({ width: 3, color: ring.color, alpha: ring.alpha });
    // The beacon: a Terminal ring with turning braille dots, its hold arc and a beam of light.
    const b = sim.beacon;
    if (b) {
      areas.rect(b.x - 5, b.y - 150, 10, 150).fill({ color: pal.good, alpha: 0.12 });
      areas.rect(b.x - 1, b.y - 150, 2, 150).fill({ color: 0xbfe3ff, alpha: 0.35 });
      areas.circle(b.x, b.y, b.radius).fill({ color: pal.good, alpha: 0.07 }).stroke({ width: 2, color: pal.good, alpha: 0.85 });
      const progress = b.hold / b.holdNeeded;
      if (progress > 0) arcFrom(areas, b.x, b.y, b.radius + 5, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2).stroke({ width: 3, color: 0xbfe3ff, alpha: 0.95 });
      for (let k = 0; k < 12; k++) {
        const ang = clock * 0.8 + (k * Math.PI) / 6;
        areas.rect(Math.round(b.x + Math.cos(ang) * (b.radius - 6)), Math.round(b.y + Math.sin(ang) * (b.radius - 6)), 1, 1).fill({ color: 0xbfe3ff, alpha: 0.9 });
      }
    }
  }

  /** `now`: simulation time in ticks, with the frame's fraction (warnings wait while the simulation stops). */
  function drawWarnings(now: number): void {
    warnings.clear();
    for (let i = warns.length - 1; i >= 0; i--) {
      const wv = warns[i]!;
      const k = warningProgress(wv, now);
      if (k === null) {
        warns.splice(i, 1);
        continue;
      }
      const pulse = opts.reduced ? 0.4 : 0.3 + 0.2 * Math.sin(clock * 18);
      // A charge and a lance warn with their line; a blink, like a blast, with the circle where it lands. A Core's laser
      // and closing ring (Nov plan B4) draw their own.
      if (isCoreWarning(wv)) {
        drawCoreWarning(warnings, wv, k, pulse);
      } else if (wv.kind === 'charge' || wv.kind === 'lance') {
        const a = wv.angle * STEP_RAD;
        const ex = wv.x + Math.cos(a) * wv.radius;
        const ey = wv.y + Math.sin(a) * wv.radius;
        warnings.moveTo(wv.x, wv.y).lineTo(ex, ey).stroke({ width: 10, color: pal.danger, alpha: pulse });
        warnings.moveTo(wv.x, wv.y).lineTo(wv.x + (ex - wv.x) * k, wv.y + (ey - wv.y) * k).stroke({ width: 2, color: pal.bad, alpha: 0.9 });
      } else if (wv.kind === 'burst') {
        warnings.circle(wv.x, wv.y, wv.radius * (2.2 - 1.2 * k)).stroke({ width: 2, color: pal.danger, alpha: 0.7 });
      } else {
        warnings.circle(wv.x, wv.y, wv.radius).stroke({ width: 1, color: pal.danger, alpha: 0.8 });
        warnings.circle(wv.x, wv.y, wv.radius * k).fill({ color: pal.danger, alpha: 0.25 });
      }
    }
  }

  function drawEnemies(sim: Sim, alpha: number): void {
    const en = sim.enemies;
    marks.clear();
    const glitchOn = !opts.reduced && clock % 0.8 < 0.08;
    for (let i = 0; i < en.top; i++) {
      if (!en.alive[i]) continue;
      const id = enemySprite(sim, i);
      const x = Math.round(lerp(en.px[i]!, en.x[i]!, alpha));
      const y = Math.round(lerp(en.py[i]!, en.y[i]!, alpha));
      const s = enemyPool.at(i);
      const flash = en.flashT[i]! > 0;
      const fr = frameOf(id, i * 0.37);
      s.texture = (flash ? atlas.white[id] : atlas.frames[id])![fr]!;
      s.anchor.set(0.5);
      s.position.set(x, y);
      const def = content.enemies[en.type[i]!];
      const facingLeft = Math.cos(en.facing[i]! * STEP_RAD) < 0;
      s.scale.set(en.boss[i] ? 1 : facingLeft ? -1 : 1, 1);
      if (en.elite[i] && !en.boss[i]) s.scale.set((facingLeft ? -1 : 1) * 1.25, 1.25);
      // A Core away in its blink is a faint ghost until it lands (its mark is on the ground).
      const away = en.boss[i] === 1 && sim.boss?.active?.kind === 'blink';
      s.alpha = away ? 0.2 : en.fuseT[i]! > 0 ? 0.5 + 0.5 * Math.sin(clock * 30) : en.hackT[i]! > 0 ? 0.75 : 1;
      s.tint = en.hackT[i]! > 0 ? 0xffc94a : opts.reduced && (en.elite[i] || en.boss[i]) ? 0xffd0dc : 0xffffff;
      const special = en.elite[i]! > 0 || en.boss[i] === 1;
      if (special) marks.circle(x, y + en.radius[i]! * 0.6, en.radius[i]! + 2).stroke({ width: 1, color: pal.danger, alpha: 0.55 });
      // Any shield shows: elites' own and the one a corruptor lends.
      if (en.shield[i]! > 0) marks.circle(x, y, en.radius[i]! + 4).stroke({ width: 1, color: 0xbfe3ff, alpha: 0.8 });
      drawStates(sim, i, x, y);
      if (def && !en.boss[i] && def.behavior.kind === 'armored') {
        const mid = en.facing[i]! * STEP_RAD;
        const half = ((def.behavior.arc / 360) * Math.PI * 2) / 2;
        arcFrom(marks, x, y, en.radius[i]! + 3, mid - half, mid + half).stroke({ width: 2, color: en.corrT[i]! > 0 ? (pal.element['corrosion'] ?? 0x45e3a6) : 0xb9bfe6, alpha: 0.9 });
      }
      for (const [pool, tint, dx] of [
        [glitchA, 0xff4d6d, -1],
        [glitchB, 0x6fe3ff, 1],
      ] as const) {
        if (special && glitchOn) {
          const g = pool.at(i);
          g.texture = atlas.white[id]![fr]!;
          g.anchor.set(0.5);
          g.position.set(x + dx, y);
          g.scale.copyFrom(s.scale);
          g.tint = tint;
          g.alpha = 0.7;
          enemies.setChildIndex(g, Math.max(0, enemies.getChildIndex(s)));
        } else if (pool.list[i]) pool.list[i]!.visible = false;
      }
    }
    enemyPool.hideFrom(en.alive, en.top);
    glitchA.hideFrom(en.alive, en.top);
    glitchB.hideFrom(en.alive, en.top);
    // A dead enemy's mark and stun stars go with it (they would linger until the slot is reused).
    pipPool.hideFrom(en.alive, en.top);
    starA.hideFrom(en.alive, en.top);
    starB.hideFrom(en.alive, en.top);
  }

  /** An enemy's element mark (a tinted drop), stun (twinkling stars) and shatter (cracks around it). */
  function drawStates(sim: Sim, i: number, x: number, y: number): void {
    const en = sim.enemies;
    const top = y - en.radius[i]! - 5;
    if (en.markT[i]! > 0 && en.mark[i]! > 0) {
      const pip = pipPool.at(i);
      const element = ELEMENT_IDS[en.mark[i]! - 1] ?? '';
      pip.texture = (atlas.frames[`mark-${element}`] ?? atlas.frames['mark-pip']!)[0]!;
      pip.anchor.set(0.5);
      pip.position.set(x, top);
      pip.tint = pal.element[element] ?? 0xffffff;
      pip.alpha = Math.min(1, en.markT[i]! / 30);
    } else if (pipPool.list[i]) pipPool.list[i]!.visible = false;
    for (const [pool, phase] of [
      [starA, 0],
      [starB, Math.PI],
    ] as const) {
      if (en.freezeT[i]! > 0) {
        const s = pool.at(i);
        const a = (opts.reduced ? 0 : clock * 5) + phase;
        s.texture = atlas.frames['stun-star']![frameOf('stun-star', i + phase)]!;
        s.anchor.set(0.5);
        s.position.set(Math.round(x + Math.cos(a) * (en.radius[i]! + 2)), Math.round(top - 2 + Math.sin(a) * 2));
      } else if (pool.list[i]) pool.list[i]!.visible = false;
    }
    if (en.vulnT[i]! > 0) {
      const r = en.radius[i]! + 3;
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + 0.6;
        const cx = x + Math.cos(a) * r;
        const cy = y + Math.sin(a) * r;
        marks.moveTo(cx, cy).lineTo(cx + Math.cos(a + 0.9) * 3, cy + Math.sin(a + 0.9) * 3).lineTo(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3).stroke({ width: 1, color: 0xbfe3ff, alpha: 0.9 });
      }
    }
  }

  function drawProps(sim: Sim): void {
    const pr = sim.props;
    const rocks = BIOME_LOOK[opts.biome ?? 'nebula'].props;
    propMarks.clear();
    for (let i = 0; i < pr.top; i++) {
      if (!pr.alive[i]) continue;
      const id = rocks[pr.look[i]!] ?? rocks[0];
      const s = propPool.at(i);
      const flash = pr.flashT[i]! > 0;
      s.texture = (flash ? atlas.white[id] : atlas.frames[id])![0]!;
      s.anchor.set(0.5);
      const x = Math.round(pr.x[i]!);
      const y = Math.round(pr.y[i]!);
      s.position.set(x, y);
      const half = Math.ceil((atlas.defs[id]?.h ?? 12) / 2);
      const k = pr.maxHp[i]! > 0 ? Math.max(0, pr.hp[i]! / pr.maxHp[i]!) : 1;
      if (k < 1) {
        // A small red life bar once it has been hit, and cracks as it weakens.
        const bw = Math.max(12, Math.round(pr.radius[i]! * 2));
        const bx = x - Math.round(bw / 2);
        const by = y - half - 4;
        propMarks.rect(bx - 1, by - 1, bw + 2, 4).fill({ color: 0x0b0c24, alpha: 0.85 });
        propMarks.rect(bx, by, Math.max(1, Math.round(bw * k)), 2).fill({ color: pal.danger });
        if (k < 0.66) propMarks.moveTo(x - 3, y - 3).lineTo(x, y).lineTo(x - 1, y + 3).stroke({ width: 1, color: 0x0b0c24, alpha: 0.9 });
        if (k < 0.33) propMarks.moveTo(x + 3, y - 2).lineTo(x + 1, y + 1).lineTo(x + 4, y + 3).stroke({ width: 1, color: 0x0b0c24, alpha: 0.9 });
      } else if (!opts.reduced) {
        // A glint now and then says "this one can be broken".
        const phase = (clock * 0.45 + i * 0.37) % 1;
        if (phase < 0.06) propMarks.rect(x + Math.round(pr.radius[i]! / 2), y - half + 1, 1, 1).fill({ color: 0xf3f5ff, alpha: 1 - phase / 0.06 });
      }
    }
    propPool.hideFrom(pr.alive, pr.top);
  }

  function drawGhosts(): void {
    let k = 0;
    for (let g = ghosts.length - 1; g >= 0; g--) {
      const gh = ghosts[g]!;
      const age = clock - gh.at;
      if (age > gh.life) {
        ghosts.splice(g, 1);
        continue;
      }
      if (age < 0) continue;
      let s = ghostSprites[k];
      if (!s) {
        s = new Sprite();
        s.anchor.set(0.5);
        ghostSprites.push(s);
        ghostLayer.addChild(s);
      }
      s.visible = true;
      s.texture = atlas.white[gh.id]?.[0] ?? atlas.pixel;
      s.tint = gh.tint;
      s.position.set(Math.round(gh.x), Math.round(gh.y));
      s.scale.set(gh.flip, 1);
      s.alpha = 0.5 * (1 - age / gh.life);
      k++;
    }
    for (; k < ghostSprites.length; k++) ghostSprites[k]!.visible = false;
  }

  /** A dash from (fx, fy) to (tx, ty): afterimages along the way (over `seconds`), sparks at both ends. */
  function dashTrail(sim: Sim | null, probe: number, fx0: number, fy0: number, tx: number, ty: number, seconds: number): void {
    const p = sim?.probes[probe];
    // The afterimages show the probe as it faced when it dashed.
    const { id, flip } = p ? probeView(p.def.sprite, probeHeading(p)) : { id: 'probe-lumen', flip: 1 };
    if (!opts.reduced) {
      const n = 5;
      for (let k = 0; k < n; k++) {
        const f = k / (n - 1);
        ghosts.push({ x: fx0 + (tx - fx0) * f, y: fy0 + (ty - fy0) * f, at: clock + seconds * f, life: GHOST_LIFE, id, flip, tint: DASH_TINT });
      }
    }
    fx.burst(fx0, fy0, DASH_TINT, 6, 40);
    fx.burst(tx, ty, 0xf3f5ff, 8, 55);
  }

  function drawPickups(sim: Sim, alpha: number): void {
    const pk = sim.pickups;
    for (let i = 0; i < pk.top; i++) {
      if (!pk.alive[i]) continue;
      const kind = pk.kind[i]!;
      const v = pk.value[i]!;
      const id = kind === 0 ? (v >= 25 ? 'xp-25' : v >= 5 ? 'xp-5' : 'xp-1') : (PICKUP_SPRITE[kind] ?? 'repair');
      const s = pickupPool.at(i);
      s.texture = atlas.frames[id]![frameOf(id, i * 0.21)]!;
      s.anchor.set(0.5);
      const bob = pk.magnet[i] || opts.reduced ? 0 : Math.round(Math.sin(clock * 4 + i) * 1);
      s.position.set(Math.round(lerp(pk.px[i]!, pk.x[i]!, alpha)), Math.round(lerp(pk.py[i]!, pk.y[i]!, alpha)) + bob);
    }
    pickupPool.hideFrom(pk.alive, pk.top);
  }

  function drawShots(sim: Sim, alpha: number): void {
    const s = sim.shots;
    // Wakes only while the run advances (not under a level-up card).
    const live = sim.status === 'running' && clock - tickAt < 0.1;
    for (let i = 0; i < s.top; i++) {
      if (!s.alive[i]) continue;
      const kind = s.kind[i]!;
      if (drawNovember(sim, i, kind, alpha, live)) continue;
      if (kind === SHOT.beam) {
        // A beam: a white core inside a halo of its element's colour, from the probe along its aim.
        if (shotPool.list[i]) shotPool.list[i]!.visible = false;
        const a = s.angle[i]! * STEP_RAD;
        const x0 = lerp(s.px[i]!, s.x[i]!, alpha);
        const y0 = lerp(s.py[i]!, s.y[i]!, alpha);
        const x1 = x0 + Math.cos(a) * s.reach[i]!;
        const y1 = y0 + Math.sin(a) * s.reach[i]!;
        const color = pal.element[ELEMENT_IDS[s.element[i]! - 1] ?? ''] ?? 0xb39dff;
        const flick = opts.reduced ? 0.35 : 0.28 + 0.12 * Math.sin(clock * 50 + i);
        beams.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: s.radius[i]! * 2 + 2, color, alpha: flick });
        beams.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 2, color: 0xf3f5ff, alpha: 0.95 });
        continue;
      }
      const id = SHOT_SPRITE[kind] ?? 'bolt';
      const sp = shotPool.at(i);
      sp.texture = atlas.frames[id]![frameOf(id, i)]!;
      sp.anchor.set(0.5);
      // A slot a hologram used keeps nothing of it.
      sp.tint = 0xffffff;
      sp.alpha = 1;
      sp.scale.set(1);
      sp.position.set(Math.round(lerp(s.px[i]!, s.x[i]!, alpha)), Math.round(lerp(s.py[i]!, s.y[i]!, alpha)));
      sp.rotation = ROTATES.has(kind)
        ? s.angle[i]! * STEP_RAD
        : kind === SHOT.blade
          ? s.reach[i]! * STEP_RAD + Math.PI / 2
          : kind === SHOT.disc && !opts.reduced
            ? clock * 14
            : 0;
    }
    shotPool.hideFrom(s.alive, s.top);
    const f = sim.foeShots;
    for (let i = 0; i < f.top; i++) {
      if (!f.alive[i]) continue;
      const sp = foePool.at(i);
      sp.texture = atlas.frames['foe-bullet']![frameOf('foe-bullet', i)]!;
      sp.anchor.set(0.5);
      sp.position.set(Math.round(lerp(f.px[i]!, f.x[i]!, alpha)), Math.round(lerp(f.py[i]!, f.y[i]!, alpha)));
    }
    foePool.hideFrom(f.alive, f.top);
  }

  /**
   * The November arsenal's shots (Nov plan B3); true when drawn whole. The harpoon adds its line and goes on to its
   * sprite; the lighthouse's beam, the thrown body, the hologram and the lobbed shell are drawn here.
   */
  function drawNovember(sim: Sim, i: number, kind: number, alpha: number, live: boolean): boolean {
    const s = sim.shots;
    const x = lerp(s.px[i]!, s.x[i]!, alpha);
    const y = lerp(s.py[i]!, s.y[i]!, alpha);
    const hide = () => {
      if (shotPool.list[i]) shotPool.list[i]!.visible = false;
    };
    if (kind === SHOT.harpoon) {
      // Its magnetic line back to the probe, with beads of light running along it.
      const owner = sim.probes[s.owner[i]!];
      if (owner) {
        const ox = lerp(owner.px, owner.x, alpha);
        const oy = lerp(owner.py, owner.y, alpha);
        beams.moveTo(ox, oy).lineTo(x, y).stroke({ width: 1, color: HOLO, alpha: 0.6 });
        for (let k = 0; k < 3; k++) {
          const f = ((opts.reduced ? 0 : clock * 1.8) + k / 3) % 1;
          beams.rect(Math.round(ox + (x - ox) * f) - 1, Math.round(oy + (y - oy) * f) - 1, 2, 2).fill({ color: 0xf3f5ff, alpha: 0.75 });
        }
      }
      return false;
    }
    if (kind === SHOT.photon) {
      // The lighthouse's beam: a long thin ray of warm light out of the probe (which stays in sight), a faint wake
      // behind its turn and a spark at its tip. Its turning angle (fractional) keeps it smooth between ticks.
      hide();
      const len = Math.hypot(s.tx[i]! - s.x[i]!, s.ty[i]! - s.y[i]!);
      const a = s.reach[i]! * STEP_RAD;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const x0 = x + cos * 8;
      const y0 = y + sin * 8;
      const x1 = x + cos * len;
      const y1 = y + sin * len;
      const color = pal.element[ELEMENT_IDS[s.element[i]! - 1] ?? ''] ?? PHOTON;
      const flick = opts.reduced ? 0.32 : 0.26 + 0.08 * Math.sin(clock * 37 + i);
      const back = a - 0.06;
      beams.moveTo(x0, y0).lineTo(x1, y1).lineTo(x + Math.cos(back) * len, y + Math.sin(back) * len).lineTo(x + Math.cos(back) * 8, y + Math.sin(back) * 8).closePath().fill({ color, alpha: 0.04 });
      beams.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: s.radius[i]! + 2, color, alpha: flick });
      beams.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 1, color: 0xfff3c4, alpha: 0.95 });
      beams.circle(x1, y1, 2).fill({ color: 0xfff3c4, alpha: 0.9 });
      return true;
    }
    if (kind === SHOT.sling) {
      // A thrown body: the enemy flies by itself; two arcs of gravity turn around it and it leaves a lilac wake.
      hide();
      const r = s.radius[i]! + 3;
      const spin = opts.reduced ? 0 : clock * 9;
      arcFrom(beams, x, y, r, spin, spin + 2).stroke({ width: 2, color: GRAVITY, alpha: 0.85 });
      arcFrom(beams, x, y, r, spin + Math.PI, spin + Math.PI + 2).stroke({ width: 2, color: GRAVITY, alpha: 0.85 });
      if (live) fx.trail(i, x, y, GRAVITY, frameDt);
      return true;
    }
    if (kind === SHOT.decoy) {
      // A hologram: its probe's own drawing, see-through and cyan, scanlines running down it and the reach of its lure
      // faint on the ground; it flickers red when it is about to blow.
      const owner = sim.probes[s.owner[i]!];
      const view = probeView(owner?.def.sprite ?? 'probe-lumen', s.angle[i]! * STEP_RAD);
      const sp = shotPool.at(i);
      sp.texture = atlas.frames[view.id]![frameOf(view.id)]!;
      sp.anchor.set(0.5);
      sp.position.set(Math.round(x), Math.round(y));
      sp.rotation = 0;
      sp.scale.set(view.flip, 1);
      const ending = s.ttl[i]! < 30 && (opts.reduced || Math.sin(clock * 30) > 0);
      sp.tint = ending ? 0xff6b7a : HOLO;
      sp.alpha = opts.reduced ? 0.55 : 0.42 + 0.14 * Math.sin(clock * 11 + i);
      const half = Math.ceil((atlas.defs[view.id]?.h ?? 16) / 2);
      for (let k = 0; k < 3; k++) {
        const ly = Math.round(y - half + ((opts.reduced ? k * 5 : clock * 18 + k * 6) % (half * 2)));
        beams.moveTo(x - half + 2, ly).lineTo(x + half - 2, ly).stroke({ width: 1, color: HOLO, alpha: 0.22 });
      }
      areas.circle(x, y, s.reach[i]!).stroke({ width: 1, color: HOLO, alpha: 0.07 });
      return true;
    }
    if (kind === SHOT.shell) {
      // A lobbed shell: its shadow runs along the ground while the shell rises and falls on its arc (its flight's
      // progress), towards a ring that closes on where it will land.
      const life = Math.max(1, s.life[i]!);
      const t = Math.max(0, Math.min(1, (life - s.ttl[i]! - 1 + alpha) / life));
      const span = life * Math.hypot(s.vx[i]!, s.vy[i]!);
      const lift = Math.min(70, span * 0.35) * 4 * t * (1 - t);
      marks.ellipse(x, y, 4, 2).fill({ color: 0x03040e, alpha: 0.45 });
      marks.circle(s.tx[i]!, s.ty[i]!, s.reach[i]! * (1.15 - 0.15 * t)).stroke({ width: 1, color: 0xff9a3c, alpha: 0.25 + 0.5 * t });
      const sp = shotPool.at(i);
      sp.texture = atlas.frames['mortar-shell']![frameOf('mortar-shell', i)]!;
      sp.anchor.set(0.5);
      sp.position.set(Math.round(x), Math.round(y - lift));
      sp.rotation = 0;
      sp.tint = 0xffffff;
      sp.alpha = 1;
      sp.scale.set(1);
      if (live) fx.trail(i, x, y - lift, 0xb9bfe6, frameDt);
      return true;
    }
    return false;
  }

  function drawProbes(sim: Sim, alpha: number): void {
    const flags = new Uint8Array(sim.probes.length);
    const coop = sim.coop;
    tagAt.length = 0;
    sim.probes.forEach((p, i) => {
      // Co-op: a fallen probe stays on the ground (to be revived) and an away one shows as a ghost.
      const shown = p.alive || (coop !== null && (p.life === 'down' || p.life === 'away'));
      flags[i] = shown ? 1 : 0;
      if (!shown) return;
      const s = probePool.at(i);
      // Eight ways (open beta): where it moves, also with manual aim (the mouse only steers the shots), as one of the
      // drawings turned for up, down and the diagonals, or mirrored for the left side.
      const view = probeView(p.def.sprite, probeHeading(p));
      s.texture = atlas.frames[view.id]![frameOf(view.id)]!;
      s.anchor.set(0.5);
      let x = Math.round(lerp(p.px, p.x, alpha));
      let y = Math.round(lerp(p.py, p.y, alpha));
      // A quirk's jump lands at once in the sim: the sprite glides there, eased out.
      const gl = glides.get(i);
      if (gl) {
        const k = (clock - gl.t0) / gl.dur;
        if (k >= 1 || opts.reduced) glides.delete(i);
        else {
          const e = 1 - (1 - k) * (1 - k);
          x = Math.round(gl.fx + (gl.tx - gl.fx) * e + (x - gl.tx));
          y = Math.round(gl.fy + (gl.ty - gl.fy) * e + (y - gl.ty));
        }
      }
      s.position.set(x, y);
      s.scale.set(view.flip, 1);
      s.tint = (hurtBlink.get(i) ?? 0) > clock ? pal.hurt : 0xffffff;
      // Its thruster while it moves and the run advances, out of the nozzle of the drawing shown (snapped to its
      // eight ways, so the puffs leave the turbine itself).
      if (p.alive && p.moving && sim.status === 'running' && clock - tickAt < 0.1 && !(coop && (p.life === 'down' || p.life === 'away'))) {
        fx.thrust(i, x, y, Math.round(probeHeading(p) / (Math.PI / 4)) * (Math.PI / 4), frameDt);
      }
      if (coop && i !== opts.probe) {
        // A teammate: its colour under it, and its name over it (drawn with the labels).
        marks.ellipse(x, y + 8, 9, 3).stroke({ width: 2, color: pal.team[i % pal.team.length]!, alpha: 0.8 });
        tagAt.push({ i, x, y });
      }
      if (coop && p.life === 'down') {
        // Fallen: grey on the ground, its countdown in red, a teammate's revive filling in green, and the reach.
        s.tint = 0x8890c4;
        s.alpha = 0.6;
        const left = Math.max(0, p.downT / Math.max(1, coop.downSeconds * 60));
        const revive = Math.min(1, p.reviveT / Math.max(1, coop.reviveSeconds * 60));
        marks.circle(x, y, coop.reviveRadius).stroke({ width: 1, color: pal.good, alpha: 0.22 });
        // The countdown is dashed and the revive solid with a «+» at its head: told apart by shape, not only colour.
        if (left > 0) dashedArc(marks, x, y, 14, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2, { width: 2, color: pal.danger, alpha: 0.9 });
        if (revive > 0) {
          const end = -Math.PI / 2 + revive * Math.PI * 2;
          arcFrom(marks, x, y, 18, -Math.PI / 2, end).stroke({ width: 3, color: pal.good, alpha: 0.95 });
          const hx = x + Math.cos(end) * 18;
          const hy = y + Math.sin(end) * 18;
          marks.moveTo(hx - 3, hy).lineTo(hx + 3, hy).moveTo(hx, hy - 3).lineTo(hx, hy + 3).stroke({ width: 2, color: 0xf3f5ff, alpha: 0.95 });
        }
        return;
      }
      if (coop && p.life === 'away') {
        s.alpha = 0.3;
        return;
      }
      // Invulnerable: a soft shimmer, not a hard blink.
      s.alpha = p.invulnT > 0 ? (opts.reduced ? 0.75 : 0.72 + 0.28 * Math.sin(clock * 14)) : 1;
      if (p.invulnT > 0) marks.circle(x, y, 10).stroke({ width: 1, color: DASH_TINT, alpha: opts.reduced ? 0.35 : 0.25 + 0.2 * Math.sin(clock * 14) });
      if (p.shield > 0) marks.circle(x, y, 11).stroke({ width: 1, color: 0xbfe3ff, alpha: 0.7 });
      if (i === opts.probe) lastProbe = { x, y };
    });
    probePool.hideFrom(flags, flags.length);
  }

  function drawParticles(): void {
    let k = 0;
    for (const p of fx.particles) {
      let s = particleSprites[k];
      if (!s) {
        s = new Sprite(atlas.pixel);
        particleSprites.push(s);
        particles.addChild(s);
      }
      s.visible = true;
      s.tint = p.color;
      s.position.set(Math.round(p.x), Math.round(p.y));
      s.scale.set(p.size);
      s.alpha = 1 - p.age / p.life;
      k++;
    }
    for (; k < particleSprites.length; k++) particleSprites[k]!.visible = false;
  }

  function drawNumbers(c: Camera, originX: number, originY: number): void {
    let k = 0;
    for (const n of fx.numbers) {
      let t = numberTexts[k];
      if (!t) {
        t = new BitmapText({ text: '0', style: { fontFamily: FONT, fontSize: 18 } });
        t.anchor.set(0.5);
        numberTexts.push(t);
        numbers.addChild(t);
      }
      t.visible = true;
      t.text = String(Math.max(1, Math.round(n.value)));
      t.tint = n.crit ? 0xffc94a : 0xffffff;
      t.scale.set(n.crit ? 1.25 : 1);
      t.alpha = n.alpha;
      t.position.set(Math.round(originX + (n.x - c.x) * c.zoom), Math.round(originY + (n.y - c.y) * c.zoom));
      k++;
    }
    for (; k < numberTexts.length; k++) numberTexts[k]!.visible = false;
    let j = 0;
    for (const l of fx.labels) {
      let t = labelTexts[j];
      if (!t) {
        t = new BitmapText({ text: ' ', style: { fontFamily: LABEL_FONT, fontSize: 15 } });
        t.anchor.set(0.5);
        labelTexts.push(t);
        numbers.addChild(t);
      }
      t.visible = true;
      t.text = l.text;
      t.tint = l.color;
      t.alpha = l.alpha;
      t.position.set(Math.round(originX + (l.x - c.x) * c.zoom), Math.round(originY + (l.y - c.y) * c.zoom));
      j++;
    }
    for (; j < labelTexts.length; j++) labelTexts[j]!.visible = false;
    // Co-op: the teammates' names over their probes.
    let g = 0;
    for (const at of tagAt) {
      const name = opts.names?.[at.i];
      if (!name) continue;
      let t = tagTexts[g];
      if (!t) {
        t = new BitmapText({ text: ' ', style: { fontFamily: LABEL_FONT, fontSize: 15 } });
        t.anchor.set(0.5, 1);
        tagTexts.push(t);
        numbers.addChild(t);
      }
      t.visible = true;
      t.text = name;
      t.tint = pal.team[at.i % pal.team.length]!;
      t.scale.set(1);
      t.position.set(Math.round(originX + (at.x - c.x) * c.zoom), Math.round(originY + (at.y - 14 - c.y) * c.zoom));
      g++;
    }
    for (; g < tagTexts.length; g++) tagTexts[g]!.visible = false;
  }

  /** Co-op: an arrow in each off-screen teammate's colour, their name inward and a life bar under it. */
  function drawMates(sim: Sim, c: Camera): void {
    mateArrows.clear();
    let g = 0;
    if (sim.coop) {
      for (const m of mateMarkers(sim.probes, c, { width: w, height: h, bars: c.bars }, opts.me ?? opts.probe, markerInsets)) {
        const team = pal.team[m.index % pal.team.length]!;
        const tint = m.state === 'down' ? pal.danger : team;
        const alpha = m.state === 'away' ? 0.4 : m.state === 'down' && !opts.reduced ? 0.55 + 0.45 * Math.sin(clock * 10) : 1;
        const ux = Math.cos(m.angle);
        const uy = Math.sin(m.angle);
        const bx0 = m.x - ux * 6;
        const by0 = m.y - uy * 6;
        mateArrows
          .poly([m.x + ux * 12, m.y + uy * 12, bx0 - uy * 9, by0 + ux * 9, bx0 + uy * 9, by0 - ux * 9])
          .fill({ color: tint, alpha })
          .stroke({ width: 2, color: 0x0b0c24, alpha: alpha * 0.9 });
        let t = mateTexts[g];
        if (!t) {
          t = new BitmapText({ text: ' ', style: { fontFamily: LABEL_FONT, fontSize: 15 } });
          mateTexts.push(t);
          numbers.addChild(t);
        }
        t.visible = true;
        t.text = opts.names?.[m.index] ?? '';
        t.tint = team;
        t.alpha = m.state === 'away' ? 0.5 : 1;
        // The name sits inward from the arrow, never past the screen's edge.
        t.anchor.set(0.5 + 0.5 * ux, 0.5 + 0.5 * uy);
        t.position.set(Math.round(m.x - ux * 20), Math.round(m.y - uy * 20));
        const left = t.position.x - t.anchor.x * t.width;
        const top = t.position.y - t.anchor.y * t.height;
        const bx = Math.round(left + (t.width - 34) / 2);
        const by = Math.round(top + t.height + 3);
        mateArrows.rect(bx, by, 34, 4).fill({ color: 0x0b0c24, alpha: 0.85 * (m.state === 'away' ? 0.5 : 1) });
        const low = m.hp <= 0.3;
        const pulse = low && !opts.reduced ? 0.55 + 0.45 * Math.sin(clock * 9) : 1;
        if (m.hp > 0) mateArrows.rect(bx, by, Math.max(1, Math.round(34 * m.hp)), 4).fill({ color: low ? pal.bad : pal.good, alpha: (m.state === 'away' ? 0.5 : 1) * pulse });
        // The 30 % line: a low life reads by where the bar ends, not only by its colour.
        mateArrows.rect(bx + 10, by - 1, 1, 6).fill({ color: 0xf3f5ff, alpha: 0.75 });
        g++;
      }
    }
    for (; g < mateTexts.length; g++) mateTexts[g]!.visible = false;
  }

  function drawBars(c: Camera): void {
    bars.clear();
    hurtFlash.clear();
    if (c.bars > 0) {
      bars.rect(0, 0, c.bars, h).fill({ color: 0x05060f });
      bars.rect(w - c.bars, 0, c.bars, h).fill({ color: 0x05060f });
      for (let y = 0; y < h; y += 4) {
        bars.rect(0, y, c.bars, 1).fill({ color: 0x141a3d, alpha: 0.5 });
        bars.rect(w - c.bars, y, c.bars, 1).fill({ color: 0x141a3d, alpha: 0.5 });
      }
      bars.rect(c.bars - 2, 0, 2, h).fill({ color: 0x0b0c24 });
      bars.rect(w - c.bars, 0, 2, h).fill({ color: 0x0b0c24 });
    }
    if (hurtAlpha > 0.01) {
      const edge = Math.round(Math.min(w, h) * 0.04);
      const left = c.bars;
      const right = w - c.bars;
      hurtFlash.rect(left, 0, right - left, edge).fill({ color: 0xff4d6d, alpha: hurtAlpha });
      hurtFlash.rect(left, h - edge, right - left, edge).fill({ color: 0xff4d6d, alpha: hurtAlpha });
      hurtFlash.rect(left, 0, edge, h).fill({ color: 0xff4d6d, alpha: hurtAlpha });
      hurtFlash.rect(right - edge, 0, edge, h).fill({ color: 0xff4d6d, alpha: hurtAlpha });
    }
  }

  return {
    app,
    feed(events, tick = lastTick) {
      for (const e of events) {
        switch (e.t) {
          case 'hit':
            fx.number(e.x, e.y - 8, e.amount, e.crit);
            if (e.element) fx.burst(e.x, e.y, pal.element[e.element] ?? 0xffffff, 3, 40);
            break;
          case 'kill':
            fx.burst(e.x, e.y, KILL_COLOR[e.enemy] ?? 0xff4d6d, e.elite ? 16 : 8, e.elite ? 90 : 60);
            break;
          case 'hurt':
            if (e.probe === (opts.me ?? opts.probe)) {
              fx.shake(Math.min(6, 3 + e.amount / 6));
              hurtAlpha = opts.reduced ? 0.25 : 0.45;
            } else hurtBlink.set(e.probe, clock + 0.18);
            break;
          case 'telegraph':
            warns.push(warningFrom(e, tick));
            break;
          case 'support':
            // A healer's pulse in Terminal green, a corruptor's in lilac.
            fx.ring(e.x, e.y, e.effect === 'heal' ? 0x45e3a6 : 0xb39dff);
            break;
          case 'blink':
            fx.burst(e.fx, e.fy, 0xb39dff, 8, 50);
            fx.burst(e.tx, e.ty, 0xe05cff, 12, 80);
            break;
          case 'blast':
            fx.burst(e.x, e.y, 0xff4d6d, 16, 100);
            fx.shake(3);
            break;
          case 'bossDown':
            fx.burst(e.x, e.y, 0xffc94a, 40, 140);
            fx.burst(e.x, e.y, 0xff4d6d, 30, 100);
            fx.shake(6);
            break;
          case 'element':
            fx.burst(e.x, e.y, pal.element[e.element] ?? 0xffffff, 2, 30);
            break;
          case 'reaction': {
            const l = reactionLabel(content, e.id);
            fx.label(e.x, e.y - 12, l.text, l.color);
            fx.burst(e.x, e.y, l.color, 12, 80);
            break;
          }
          case 'evolve': {
            // The gold ring on whoever evolved (a teammate's too), not always on the camera's probe.
            const at = lastSim?.probes[e.probe] ?? lastProbe;
            fx.ring(at.x, at.y, 0xffc94a);
            fx.burst(at.x, at.y, 0xffc94a, 24, 90);
            break;
          }
          case 'pickup':
            if (e.kind === 'magnet') {
              const at = lastSim?.probes[e.probe] ?? lastProbe;
              fx.ring(at.x, at.y, 0x45e3a6);
              fx.burst(at.x, at.y, 0x45e3a6, 18, 90);
            }
            break;
          case 'evade': {
            // Fase cuántica (Nov plan B2): the hit went through; a cyan word over the probe says so.
            const at = lastSim?.probes[e.probe] ?? lastProbe;
            fx.label(at.x, at.y - 14, copy.arena.evaded, 0x6fe3ff);
            break;
          }
          case 'propBreak':
            fx.burst(e.x, e.y, parseInt(look.dust.slice(1), 16), 12, 70);
            fx.burst(e.x, e.y, 0xf3f5ff, 4, 40);
            break;
          case 'dash':
            if (e.ticks === 0) glides.set(e.probe, { fx: e.fx, fy: e.fy, tx: e.tx, ty: e.ty, t0: clock, dur: GLIDE_S });
            dashTrail(lastSim, e.probe, e.fx, e.fy, e.tx, e.ty, e.ticks > 0 ? e.ticks / 60 : GLIDE_S);
            break;
          default:
            break;
        }
      }
    },
    render(sim, alpha) {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      clock += dt;
      frameDt = dt;
      if (sim.tick !== seenTick) {
        seenTick = sim.tick;
        tickAt = clock;
      }
      const p = sim.probes[opts.probe] ?? sim.probes[0]!;
      const focus = { x: lerp(p.px, p.x, alpha), y: lerp(p.py, p.y, alpha) };
      clampCloser();
      shownCloser = opts.reduced || Math.abs(closer - shownCloser) < 0.02 ? closer : shownCloser + (closer - shownCloser) * (1 - Math.exp(-dt * 16));
      const c = cameraFor(w, h, focus, opts.vision, shownCloser);
      cam = c;
      const shake = fx.update(dt);
      hurtAlpha *= 0.88;
      const originX = Math.round(c.bars + (c.worldW * c.zoom) / 2);
      const originY = Math.round(h / 2);
      world.scale.set(c.zoom);
      world.position.set(originX - Math.round(c.x * c.zoom) + shake.x, originY - Math.round(c.y * c.zoom) + shake.y);
      for (const [layer, speed] of [
        [ground, 0.5],
        [nebula, 0.25],
      ] as const) {
        layer.position.set(c.bars, 0);
        layer.width = Math.round(c.worldW * c.zoom);
        layer.height = h;
        layer.tileScale.set(c.zoom);
        layer.tilePosition.set(-Math.round(c.x * speed * c.zoom), -Math.round(c.y * speed * c.zoom));
      }
      syncChunks(c);
      lastSim = sim;
      drawProps(sim);
      drawAreas(sim);
      lastTick = sim.tick;
      drawWarnings(sim.tick + alpha);
      drawCoreBeam(beams, sim, opts.reduced, clock);
      drawEnemies(sim, alpha);
      drawPickups(sim, alpha);
      drawShots(sim, alpha);
      drawGhosts();
      drawProbes(sim, alpha);
      drawParticles();
      drawNumbers(c, originX + shake.x, originY + shake.y);
      drawMates(sim, c);
      drawBars(c);
      app.render();
    },
    resize(nw, nh) {
      w = Math.max(1, Math.floor(nw));
      h = Math.max(1, Math.floor(nh));
      app.renderer.resize(w, h);
      paintVeil();
    },
    camera: () => cam,
    zoom(steps) {
      closer += Math.round(steps);
      clampCloser();
    },
    zoomLevel: () => closer,
    follow: (probe: number) => {
      opts.probe = probe;
    },
    setInsets(insets) {
      markerInsets = insets;
    },
    setReduced(on) {
      opts.reduced = on;
      fx.setReduced(on);
    },
    setColorVision(mode) {
      opts.colorVision = mode;
      pal = stagePalette(mode);
    },
    destroy() {
      for (const box of chunks.values()) box.destroy({ children: true });
      chunks.clear();
      atlas.destroy();
      // Fonts are global to PixiJS: a second run would otherwise warn and keep the old pages (M3a minor 4).
      BitmapFont.uninstall(FONT);
      BitmapFont.uninstall(LABEL_FONT);
      starTex.destroy(true);
      nebulaTex.destroy(true);
      for (const t of dustDots) t.destroy(true);
      app.destroy({ removeView: false }, { children: true });
    },
  };
}
