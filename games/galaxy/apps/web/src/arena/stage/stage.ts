import 'pixi.js/unsafe-eval';
import { AREA, type BiomeId, type Content, ELEMENT_IDS, SHOT, type Sim, type SimEvent } from '@galaxy/sim';
import { Application, BitmapFont, BitmapText, Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import { BAYER, buildAtlas, ditherTexture, fbm } from './atlas';
import { type Camera, cameraFor } from './camera';
import { createFx, reactionLabel } from './fx';
import { BIOME_LOOK } from './biomes';
import { CHUNK, terrainAt } from './terrain';
import { type Warning, warningFrom, warningProgress } from './warnings';

// The arena renderer (GDD §18.4, DESIGN_SYSTEM §8 quater): PixiJS only draws the simulation. It interpolates between
// ticks, follows the probe with a pixel-snapped camera capped at 21:9, and adds the juice: hit flashes, numbers,
// particles, shake, the Static's glitch on elites and the boss, warnings before every strike and the beacon.

export interface StageOptions {
  reduced: boolean;
  /** Extra view from a starfield relic (camera only). */
  vision: number;
  /** The probe the camera follows. */
  probe: number;
  /** The run seed (decoration). */
  seed: string;
  /** Keep the drawing buffer (screenshots in tests). */
  preserve?: boolean;
  /** The sector's biome: its nebula, stars, dust and rocks (default: the M3a nebula). */
  biome?: BiomeId;
}

export interface Stage {
  readonly app: Application;
  render(sim: Sim, alpha: number): void;
  /** The events of one simulation step (call once per step, in order), with its tick (default: the last drawn). */
  feed(events: readonly SimEvent[], tick?: number): void;
  resize(w: number, h: number): void;
  camera(): Camera | null;
  destroy(): void;
}

/** Sprite per shot kind (systems/weapons.ts SHOT; the beam is drawn as a line, not a sprite). */
const SHOT_SPRITE = ['bolt', 'lance', 'arc', 'drone-bolt', 'orb', 'drone', 'relic-ray', 'jet', 'quasar', 'chaos', 'reflected', 'blade', 'bolt', 'missile', 'shard', 'mine', 'disc', 'turret', 'split-shard'];
const ROTATES = new Set<number>([SHOT.bolt, SHOT.lance, SHOT.ray, SHOT.jet, SHOT.quasar, SHOT.missile, SHOT.shard, SHOT.split, SHOT.turret]);
const KILL_COLOR: Record<string, number> = { mite: 0xff4d6d, cell: 0xb39dff, cellet: 0xb39dff, ray: 0x6fb7ff, spitter: 0xff9a3c, shell: 0xb9bfe6 };
const ELEMENT_COLOR: Record<string, number> = {
  burn: 0xff9a3c,
  slow: 0x6fb7ff,
  corrosion: 0x45e3a6,
  shock: 0xb39dff,
  hack: 0xffc94a,
  leech: 0xff4d6d,
  breach: 0x17b07e,
  chain: 0x6fe3ff,
  pure: 0xf3f5ff,
  prism: 0xffc94a,
  invert: 0x7259ee,
};
const STEP_RAD = (Math.PI * 2) / 4096;
const FONT = 'gs-dmg';
/** Reaction names: letters with Spanish accents. */
const LABEL_FONT = 'gs-react';

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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export async function createStage(canvas: HTMLCanvasElement, content: Content, opts: StageOptions): Promise<Stage> {
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
    chars: [['a', 'z'], ['A', 'Z'], 'áéíóúÁÉÍÓÚñÑüÜ '],
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
  const world = new Container();
  const decor = new Container();
  const pickups = new Container();
  const areas = new Graphics();
  // Light that adds up (beams, flames, blasts): glows on the dark field instead of muddying it.
  const beams = new Graphics();
  beams.blendMode = 'add';
  const warnings = new Graphics();
  const marks = new Graphics();
  const enemies = new Container({ label: 'enemies' });
  const probes = new Container();
  const shots = new Container();
  const particles = new Container();
  world.addChild(decor, pickups, areas, warnings, marks, enemies, probes, beams, shots, particles);
  const numbers = new Container();
  const bars = new Graphics();
  const hurtFlash = new Graphics();
  app.stage.addChild(nebula, ground, world, numbers, bars, hurtFlash);

  const enemyPool = new SpritePool(enemies);
  const glitchA = new SpritePool(enemies);
  const glitchB = new SpritePool(enemies);
  const pickupPool = new SpritePool(pickups);
  const shotPool = new SpritePool(shots);
  const foePool = new SpritePool(shots);
  const probePool = new SpritePool(probes);
  const particleSprites: Sprite[] = [];
  const numberTexts: BitmapText[] = [];
  const labelTexts: BitmapText[] = [];
  const pipPool = new SpritePool(enemies);
  const starA = new SpritePool(enemies);
  const starB = new SpritePool(enemies);
  let lastProbe = { x: 0, y: 0 };

  const dustDots = [0, 1, 2, 3, 4, 5].map((v) =>
    ditherTexture(3, 4, (x, y) => (((v + 1) >> (x + y * 2)) & 1 && (x === 0 || x === 2) ? look.dust : null)),
  );
  const chunks = new Map<string, Container>();

  const fx = createFx(opts.reduced);
  const warns: Warning[] = [];
  /** The simulation tick of the last frame drawn (feeds without a tick use it). */
  let lastTick = 0;
  let hurtAlpha = 0;
  let last = performance.now();
  let clock = 0;
  let cam: Camera | null = null;

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
          // Clouds live in the nebula layer; the chunks carry the rocks and the braille dust.
          if (d.kind === 'cloud') continue;
          const tex = d.kind === 'rock' ? atlas.frames[d.sprite ?? 'rock-' + (d.variant + 1)]![0]! : dustDots[d.variant]!;
          const s = new Sprite(tex);
          s.anchor.set(0.5);
          s.position.set(Math.round(d.x), Math.round(d.y));
          s.scale.set(d.scale);
          if (d.kind === 'dust') s.alpha = 0.55;
          if (d.kind === 'rock') s.alpha = 0.9;
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
          areas.arc(x, y, r * (0.35 + 0.2 * k), a0, a0 + 1.6).stroke({ width: 2, color: 0xb39dff, alpha: 0.55 });
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
      } else if (kind === AREA.slowField) {
        areas.circle(x, y, r).fill({ color: 0x6fb7ff, alpha: 0.12 }).stroke({ width: 1, color: 0x6fb7ff, alpha: 0.5 });
      } else if (kind === AREA.aura) {
        const arc = a.arc[i]!;
        if (arc > 0) {
          const mid = a.angle[i]! * STEP_RAD;
          const half = (arc * STEP_RAD) / 2;
          areas.moveTo(x, y).arc(x, y, r, mid - half, mid + half).closePath().fill({ color: 0x45e3a6, alpha: 0.12 }).stroke({ width: 1, color: 0x45e3a6, alpha: 0.4 });
        } else {
          areas.circle(x, y, r).fill({ color: 0x45e3a6, alpha: 0.08 }).stroke({ width: 1, color: 0x45e3a6, alpha: 0.35 });
        }
      }
    }
    // Evolution rings around the probe.
    for (const ring of fx.rings) areas.circle(ring.x, ring.y, ring.radius).stroke({ width: 3, color: ring.color, alpha: ring.alpha });
    // The beacon: a Terminal ring with turning braille dots, its hold arc and a beam of light.
    const b = sim.beacon;
    if (b) {
      areas.rect(b.x - 5, b.y - 150, 10, 150).fill({ color: 0x45e3a6, alpha: 0.12 });
      areas.rect(b.x - 1, b.y - 150, 2, 150).fill({ color: 0xbfe3ff, alpha: 0.35 });
      areas.circle(b.x, b.y, b.radius).fill({ color: 0x45e3a6, alpha: 0.07 }).stroke({ width: 2, color: 0x45e3a6, alpha: 0.85 });
      const progress = b.hold / b.holdNeeded;
      if (progress > 0) areas.arc(b.x, b.y, b.radius + 5, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2).stroke({ width: 3, color: 0xbfe3ff, alpha: 0.95 });
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
      // A charge and a lance warn with their line; a blink, like a blast, with the circle where it lands.
      if (wv.kind === 'charge' || wv.kind === 'lance') {
        const a = wv.angle * STEP_RAD;
        const ex = wv.x + Math.cos(a) * wv.radius;
        const ey = wv.y + Math.sin(a) * wv.radius;
        warnings.moveTo(wv.x, wv.y).lineTo(ex, ey).stroke({ width: 10, color: 0xff4d6d, alpha: pulse });
        warnings.moveTo(wv.x, wv.y).lineTo(wv.x + (ex - wv.x) * k, wv.y + (ey - wv.y) * k).stroke({ width: 2, color: 0xff6b7a, alpha: 0.9 });
      } else if (wv.kind === 'burst') {
        warnings.circle(wv.x, wv.y, wv.radius * (2.2 - 1.2 * k)).stroke({ width: 2, color: 0xff4d6d, alpha: 0.7 });
      } else {
        warnings.circle(wv.x, wv.y, wv.radius).stroke({ width: 1, color: 0xff4d6d, alpha: 0.8 });
        warnings.circle(wv.x, wv.y, wv.radius * k).fill({ color: 0xff4d6d, alpha: 0.25 });
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
      if (special) marks.circle(x, y + en.radius[i]! * 0.6, en.radius[i]! + 2).stroke({ width: 1, color: 0xff4d6d, alpha: 0.55 });
      // Any shield shows: elites' own and the one a corruptor lends.
      if (en.shield[i]! > 0) marks.circle(x, y, en.radius[i]! + 4).stroke({ width: 1, color: 0xbfe3ff, alpha: 0.8 });
      drawStates(sim, i, x, y);
      if (def && !en.boss[i] && def.behavior.kind === 'armored') {
        const mid = en.facing[i]! * STEP_RAD;
        const half = ((def.behavior.arc / 360) * Math.PI * 2) / 2;
        marks.arc(x, y, en.radius[i]! + 3, mid - half, mid + half).stroke({ width: 2, color: en.corrT[i]! > 0 ? 0x45e3a6 : 0xb9bfe6, alpha: 0.9 });
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
      pip.texture = atlas.frames['mark-pip']![0]!;
      pip.anchor.set(0.5);
      pip.position.set(x, top);
      pip.tint = ELEMENT_COLOR[ELEMENT_IDS[en.mark[i]! - 1] ?? ''] ?? 0xffffff;
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

  function drawPickups(sim: Sim, alpha: number): void {
    const pk = sim.pickups;
    for (let i = 0; i < pk.top; i++) {
      if (!pk.alive[i]) continue;
      const kind = pk.kind[i]!;
      const v = pk.value[i]!;
      const id = kind === 0 ? (v >= 25 ? 'xp-25' : v >= 5 ? 'xp-5' : 'xp-1') : kind === 1 ? 'coin' : kind === 2 ? 'dust' : 'repair';
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
    for (let i = 0; i < s.top; i++) {
      if (!s.alive[i]) continue;
      const kind = s.kind[i]!;
      if (kind === SHOT.beam) {
        // A beam: a white core inside a halo of its element's colour, from the probe along its aim.
        if (shotPool.list[i]) shotPool.list[i]!.visible = false;
        const a = s.angle[i]! * STEP_RAD;
        const x0 = lerp(s.px[i]!, s.x[i]!, alpha);
        const y0 = lerp(s.py[i]!, s.y[i]!, alpha);
        const x1 = x0 + Math.cos(a) * s.reach[i]!;
        const y1 = y0 + Math.sin(a) * s.reach[i]!;
        const color = ELEMENT_COLOR[ELEMENT_IDS[s.element[i]! - 1] ?? ''] ?? 0xb39dff;
        const flick = opts.reduced ? 0.35 : 0.28 + 0.12 * Math.sin(clock * 50 + i);
        beams.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: s.radius[i]! * 2 + 2, color, alpha: flick });
        beams.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 2, color: 0xf3f5ff, alpha: 0.95 });
        continue;
      }
      const id = SHOT_SPRITE[kind] ?? 'bolt';
      const sp = shotPool.at(i);
      sp.texture = atlas.frames[id]![frameOf(id, i)]!;
      sp.anchor.set(0.5);
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

  function drawProbes(sim: Sim, alpha: number): void {
    const flags = new Uint8Array(sim.probes.length);
    sim.probes.forEach((p, i) => {
      flags[i] = p.alive ? 1 : 0;
      if (!p.alive) return;
      const s = probePool.at(i);
      const id = p.def.sprite;
      s.texture = atlas.frames[id]![frameOf(id)]!;
      s.anchor.set(0.5);
      const x = Math.round(lerp(p.px, p.x, alpha));
      const y = Math.round(lerp(p.py, p.y, alpha));
      s.position.set(x, y);
      s.scale.set(Math.cos(p.facing * STEP_RAD) < -0.01 ? -1 : 1, 1);
      s.alpha = p.invulnT > 0 && !opts.reduced && Math.floor(clock * 20) % 2 === 0 ? 0.45 : 1;
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
            if (e.element) fx.burst(e.x, e.y, ELEMENT_COLOR[e.element] ?? 0xffffff, 3, 40);
            break;
          case 'kill':
            fx.burst(e.x, e.y, KILL_COLOR[e.enemy] ?? 0xff4d6d, e.elite ? 16 : 8, e.elite ? 90 : 60);
            break;
          case 'hurt':
            fx.shake(Math.min(6, 3 + e.amount / 6));
            hurtAlpha = opts.reduced ? 0.25 : 0.45;
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
            fx.burst(e.x, e.y, ELEMENT_COLOR[e.element] ?? 0xffffff, 2, 30);
            break;
          case 'reaction': {
            const l = reactionLabel(content, e.id);
            fx.label(e.x, e.y - 12, l.text, l.color);
            fx.burst(e.x, e.y, l.color, 12, 80);
            break;
          }
          case 'evolve':
            fx.ring(lastProbe.x, lastProbe.y, 0xffc94a);
            fx.burst(lastProbe.x, lastProbe.y, 0xffc94a, 24, 90);
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
      const p = sim.probes[opts.probe] ?? sim.probes[0]!;
      const focus = { x: lerp(p.px, p.x, alpha), y: lerp(p.py, p.y, alpha) };
      const c = cameraFor(w, h, focus, opts.vision);
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
      drawAreas(sim);
      lastTick = sim.tick;
      drawWarnings(sim.tick + alpha);
      drawEnemies(sim, alpha);
      drawPickups(sim, alpha);
      drawShots(sim, alpha);
      drawProbes(sim, alpha);
      drawParticles();
      drawNumbers(c, originX + shake.x, originY + shake.y);
      drawBars(c);
      app.render();
    },
    resize(nw, nh) {
      w = Math.max(1, Math.floor(nw));
      h = Math.max(1, Math.floor(nh));
      app.renderer.resize(w, h);
    },
    camera: () => cam,
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
