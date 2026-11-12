import { type BiomeId, type Sim, TICK_HZ } from '@galaxy/sim';

// The arena's environment (plan «banda sonora, skins, perfil y entorno», part E; DESIGN_SYSTEM §8 quater): effects
// on the backdrop that answer to what happens in the run, drawing only (the simulation never changes). Each is one
// entry of ENVIRONMENT; a future world event plugs in as one more. Its level comes from the simulation's state, not
// from its events, so a replay that seeks lands on the right sky.
//
// The first entry is the Núcleo's storm: while a Core is up, the nebula turns towards the danger colour, the veil
// darkens, shock waves leave the Core, the stars stretch towards it, the screen's edges pulse red and each biome adds
// its touch. Photosensitivity rules: at most FLASH_CAP flashes in any second, nothing above OVERLAY_MAX of opacity and
// never a full-screen red. With reduced motion only the tint and a still vignette remain.
//
// Like fx.ts this is plain state: it draws through a Painter (a subset of Pixi's Graphics), so it is testable without
// a GPU. Coordinates are art pixels (screen pixels ÷ the camera's zoom), the arena's own pixel grid. What it draws is
// light: the stage adds it to the sky (warm embers over the blue void glow instead of turning olive).

/** The 2D calls an effect draws with: a subset of Pixi's Graphics (tests record them). */
export interface Painter {
  rect(x: number, y: number, w: number, h: number): this;
  circle(x: number, y: number, r: number): this;
  moveTo(x: number, y: number): this;
  lineTo(x: number, y: number): this;
  fill(style: { color: number; alpha: number }): this;
  stroke(style: { width: number; color: number; alpha: number }): this;
}

/** What an effect sees of the screen this frame, in art pixels. */
export interface EnvScene {
  /** The field between the side bars: its left edge, width and height. */
  left: number;
  width: number;
  height: number;
  /** The Core on screen (or where it fell, while the storm fades), or null. */
  boss: { x: number; y: number } | null;
  /** The meaningful danger colour (the colour-blind palette's). */
  danger: number;
  biome: BiomeId;
  reduced: boolean;
}

/** How the effects touch the stage's own backdrop layers this frame. */
export interface BackdropTouch {
  /** The storm cloud laid over the nebula (its shape, in `color`): its opacity, never above OVERLAY_MAX. */
  cloud: number;
  color: number;
  /** How bright the nebula and the stars stay (1: untouched). */
  light: number;
  /** How far the dark veil goes from its usual opacity towards OVERLAY_MAX (0–1). */
  veil: number;
  /** The stars pulled towards a point (art pixels), the farthest by `px`; null: still. */
  pull: { x: number; y: number; px: number } | null;
}

/** One environment effect. `level` is 0 (off) to 1 (full); `update` and `draw` get it every frame. */
export interface EnvironmentEffect {
  readonly id: string;
  level(sim: Sim): number;
  /** Advances its own animation by `dt` seconds. */
  update(dt: number, level: number, scene: EnvScene): void;
  /** Draws it on `g` (screen space, art pixels) and says how it touches the backdrop. */
  draw(g: Painter, level: number, scene: EnvScene): BackdropTouch;
}

/** Photosensitivity: no flash or overlay of the environment is more opaque than this. */
export const OVERLAY_MAX = 0.35;
/** Photosensitivity: flashes (lightning, glitch tears) started in any one second, at most. */
export const FLASH_CAP = 2;
/** The storm comes in over 2 s of Core, and goes over 2 s after it falls. */
export const STORM_RAMP_TICKS = 2 * TICK_HZ;
/** The red vignette's slow breath (s): far from a flicker, under once a second. */
export const VIGNETTE_PERIOD = 2.6;

export const CALM: BackdropTouch = { cloud: 0, color: 0xffffff, light: 1, veil: 0, pull: null };

/** The storm's level from the run's phase alone (seeking a replay shows it right). */
export function stormLevel(sim: Pick<Sim, 'phase' | 'phaseTick'>): number {
  if (sim.phase === 'boss') return Math.min(1, sim.phaseTick / STORM_RAMP_TICKS);
  // The beacon opens the tick the Core falls (systems/layers.ts onBossDown), with its phaseTick from 0.
  if (sim.phase === 'beacon') return Math.max(0, 1 - sim.phaseTick / STORM_RAMP_TICKS);
  return 0;
}

const CLOUD = 0.3;
const DIM = 0.3;
/** How far the farthest stars are pulled towards the Core at full storm (art px). */
const PULL = 4;
const WAVE_EVERY = 1.7;
const WAVE_LIFE = 3.4;
const WAVE_ALPHA = 0.3;
/** The vignette's bands, outside in (their opacity at full storm and the top of its breath). */
const VIGNETTE = [0.2, 0.13, 0.075, 0.035];
/** The first flash comes a little after the storm rises (s). */
const FIRST_FLASH = 0.9;
const BOLT_LIFE = 0.24;
/** A lightning's glow radius (art px) and the ordered dither it fades with (the nebula's Bayer 4×4). */
const GLOW_R = 30;
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const TEAR_LIFE = 0.16;

const VIOLET = 0xb39dff;
const VIOLET_CORE = 0xf6eaff;
const VIOLET_GLOW = 0xd9b8ff;
const CYAN = 0x6fe3ff;
const MAGENTA = 0xe05cff;
const SHARDS = [0xf3f5ff, 0xbfe3ff, 0x9fc4e8];
/** Orange embers (a dim yellow turns olive) with a pale hot core. */
const EMBERS = [0xff9d2e, 0xffb347, 0xff8a2e];
const EMBER_CORE = 0xffe6a0;
/** The reef's own light (its dust and stars), never the loot's Terminal green. */
const GLOWS = [0x5fc9bb, 0x7fd8ee, 0xffd6e6];

/** A mote of a biome's field, in field coordinates (0–1) so a resize keeps it in place. */
interface Mote {
  u: number;
  v: number;
  speed: number;
  size: number;
  color: number;
  phase: number;
  alpha: number;
}

interface Flash {
  at: number;
  life: number;
  /** A bolt: its main stroke and a branch, as x, y pairs. A tear: slices as x, y, w, h. */
  main: number[];
  side: number[];
  /** A tear's loose pixels, as x, y pairs. */
  dots: number[];
}

/** How many motes each biome's touch keeps (nebula and rift flash instead). */
const FIELD: Record<BiomeId, number> = { nebula: 0, ice: 150, reef: 16, forge: 100, rift: 0 };

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** A number seed from a run's seed text (FNV-1a). */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const wrap = (x: number) => x - Math.floor(x);

export interface BossStorm extends EnvironmentEffect {
  /** Seconds of storm so far (it runs while the storm is up and starts over with the next Core). */
  readonly clock: number;
  /** Flashes started so far. */
  readonly flashCount: number;
}

/** The Núcleo's storm (the first ENVIRONMENT entry). */
export function createBossStorm(seed = 1): BossStorm {
  const rand = lcg(seed);
  let clock = 0;
  // A clock that never starts over: the flash cap holds across storms and replay seeks too.
  let wall = 0;
  let flashCount = 0;
  let nextFlash = FIRST_FLASH;
  const recent: number[] = [];
  const flashes: Flash[] = [];
  const fields = new Map<BiomeId, Mote[]>();

  function fieldOf(biome: BiomeId): Mote[] {
    let f = fields.get(biome);
    if (f) return f;
    const colors = biome === 'ice' ? SHARDS : biome === 'forge' ? EMBERS : GLOWS;
    f = Array.from({ length: FIELD[biome] }, () => ({
      u: rand(),
      v: rand(),
      speed: biome === 'reef' ? 2.2 + rand() * 1.2 : 0.65 + rand() * 0.7,
      size: biome === 'ice' ? 3 + Math.floor(rand() * 4) : biome === 'reef' ? 3 + Math.floor(rand() * 4) : rand() < 0.6 ? 2 : 1,
      color: colors[Math.floor(rand() * colors.length)]!,
      phase: rand() * Math.PI * 2,
      alpha: 0.55 + rand() * 0.45,
    }));
    fields.set(biome, f);
    return f;
  }

  /** The blizzard's wind (radians and art px per second): mostly down and to the right, in gusts. */
  const wind = () => ({ angle: 0.42 + 0.12 * Math.sin(clock * 0.6), speed: 170 * (1 + 0.3 * Math.sin(clock * 0.9 + 1)) });

  function moveField(dt: number, scene: EnvScene): void {
    const field = fieldOf(scene.biome);
    const w = Math.max(1, scene.width);
    const h = Math.max(1, scene.height);
    const gust = wind();
    for (const m of field) {
      if (scene.biome === 'ice') {
        m.u = wrap(m.u + (Math.cos(gust.angle) * gust.speed * m.speed * dt) / w);
        m.v = wrap(m.v + (Math.sin(gust.angle) * gust.speed * m.speed * dt) / h);
      } else if (scene.biome === 'forge') {
        // Embers fall and sway.
        m.u = wrap(m.u + (Math.sin(clock * 1.3 + m.phase) * 7 * dt) / w);
        m.v = wrap(m.v + (32 * m.speed * dt) / h);
      } else if (scene.biome === 'reef') {
        // Glows rise slowly, like plankton.
        m.u = wrap(m.u + (Math.sin(clock * 0.5 + m.phase) * 3 * dt) / w);
        m.v = wrap(m.v - (5 * dt) / h);
      }
    }
  }

  function startFlash(scene: EnvScene): void {
    const w = scene.width;
    const h = scene.height;
    const f: Flash = { at: clock, life: scene.biome === 'nebula' ? BOLT_LIFE : TEAR_LIFE, main: [], side: [], dots: [] };
    if (scene.biome === 'nebula') {
      // A jagged bolt down from the top part of the sky, with one branch.
      let x = scene.left + w * (0.12 + rand() * 0.76);
      let y = h * rand() * 0.2;
      const n = 7 + Math.floor(rand() * 4);
      f.main.push(x, y);
      for (let k = 0; k < n; k++) {
        x += (rand() - 0.5) * 14;
        y += 8 + rand() * 9;
        f.main.push(x, y);
      }
      const from = 2 + Math.floor(rand() * (n - 3));
      let bx = f.main[from * 2]!;
      let by = f.main[from * 2 + 1]!;
      const dir = rand() < 0.5 ? -1 : 1;
      f.side.push(bx, by);
      for (let k = 0; k < 4; k++) {
        bx += dir * (2 + rand() * 8);
        by += 4 + rand() * 7;
        f.side.push(bx, by);
      }
    } else {
      // A glitch tear: a few slices of the sky slid sideways, with loose pixels.
      const y0 = h * (0.08 + rand() * 0.84);
      const x0 = scene.left + w * (0.05 + rand() * 0.7);
      const slices = 2 + Math.floor(rand() * 3);
      let y = y0;
      for (let k = 0; k < slices; k++) {
        const sh = 2 + Math.floor(rand() * 3);
        f.main.push(x0 + (rand() - 0.5) * 18, y, 40 + rand() * 110, sh);
        y += sh;
      }
      for (let k = 0; k < 6; k++) f.dots.push(x0 + rand() * 140, y0 - 4 + rand() * (y - y0 + 8));
    }
    flashes.push(f);
    recent.push(wall);
    flashCount++;
  }

  function vignette(g: Painter, scene: EnvScene, k: number): void {
    // Concentric frames that never overlap (top and bottom bands full width, the sides between them).
    const b = Math.max(2, Math.round(scene.height * 0.02));
    const L = Math.round(scene.left);
    const W = Math.round(scene.width);
    const H = Math.round(scene.height);
    VIGNETTE.forEach((a, i) => {
      const style = { color: scene.danger, alpha: a * k };
      const o = i * b;
      g.rect(L + o, o, W - 2 * o, b).fill(style);
      g.rect(L + o, H - o - b, W - 2 * o, b).fill(style);
      g.rect(L + o, o + b, b, H - 2 * (o + b)).fill(style);
      g.rect(L + W - o - b, o + b, b, H - 2 * (o + b)).fill(style);
    });
  }

  function waves(g: Painter, scene: EnvScene, level: number): void {
    const boss = scene.boss!;
    const x = Math.round(boss.x);
    const y = Math.round(boss.y);
    const reach = Math.hypot(scene.width, scene.height) * 0.8;
    const k0 = Math.floor(clock / WAVE_EVERY);
    for (let k = k0; k >= 0 && k > k0 - 3; k--) {
      const p = (clock - k * WAVE_EVERY) / WAVE_LIFE;
      if (p >= 1) continue;
      const r = Math.round(4 + (1 - (1 - p) * (1 - p)) * reach);
      const a = WAVE_ALPHA * level * (1 - p) ** 1.5;
      // A crisp front and a stepped wake behind it, fading inwards.
      g.circle(x, y, r).stroke({ width: 1, color: scene.danger, alpha: a });
      if (r > 3) g.circle(x, y, r - 2).stroke({ width: 1, color: scene.danger, alpha: a * 0.5 });
      if (r > 6) g.circle(x, y, r - 5).stroke({ width: 1, color: scene.danger, alpha: a * 0.25 });
    }
  }

  function biomeTouch(g: Painter, scene: EnvScene, level: number): void {
    const field = fieldOf(scene.biome);
    const shown = Math.round(field.length * level);
    const at = (m: Mote) => ({ x: Math.round(scene.left + m.u * scene.width), y: Math.round(m.v * scene.height) });
    if (scene.biome === 'ice') {
      // A blizzard of shards: short streaks along the wind.
      const gust = wind();
      const dx = Math.cos(gust.angle);
      const dy = Math.sin(gust.angle);
      for (let i = 0; i < shown; i++) {
        const m = field[i]!;
        const { x, y } = at(m);
        g.moveTo(x, y)
          .lineTo(Math.round(x - dx * m.size), Math.round(y - dy * m.size))
          .stroke({ width: 1, color: m.color, alpha: 0.33 * m.alpha * level });
      }
    } else if (scene.biome === 'forge') {
      // A rain of embers, each glowing softly, with a fading trail above it.
      for (let i = 0; i < shown; i++) {
        const m = field[i]!;
        const { x, y } = at(m);
        const a = 0.34 * Math.max(0.75, m.alpha) * level * (0.85 + 0.15 * Math.sin(clock * 2.2 + m.phase));
        g.rect(x, y, m.size, m.size).fill({ color: m.color, alpha: a });
        if (m.size > 1) g.rect(x, y + 1, 1, 1).fill({ color: EMBER_CORE, alpha: a * 0.8 });
        g.rect(x, y - 1, 1, 1).fill({ color: m.color, alpha: a * 0.5 });
        g.rect(x, y - 2, 1, 1).fill({ color: m.color, alpha: a * 0.25 });
      }
    } else if (scene.biome === 'reef') {
      // Bioluminescent pulses: soft stepped glows that swell and fade on their own slow beat (no rings: a ring on the
      // ground is a game zone).
      for (let i = 0; i < shown; i++) {
        const m = field[i]!;
        const { x, y } = at(m);
        const p = (Math.sin((clock / m.speed) * Math.PI * 2 + m.phase) + 1) / 2;
        const glow = p * p * level;
        if (glow < 0.02) continue;
        const r = m.size * (0.7 + 0.5 * p);
        g.circle(x, y, Math.round(r * 2)).fill({ color: m.color, alpha: 0.05 * glow });
        g.circle(x, y, Math.round(r)).fill({ color: m.color, alpha: 0.1 * glow });
        g.rect(x - 1, y - 1, 2, 2).fill({ color: m.color, alpha: 0.32 * glow });
      }
    }
  }

  function drawFlashes(g: Painter, scene: EnvScene, level: number): void {
    for (const f of flashes) {
      const k = Math.max(0, 1 - (clock - f.at) / f.life);
      if (scene.biome === 'nebula') {
        // The strike holds for a moment, then fades; a stepped glow lights the cloud around it.
        const a = OVERLAY_MAX * level * Math.min(1, k / 0.6);
        const mid = Math.floor(f.main.length / 4) * 2;
        const mx = Math.round(f.main[mid]!);
        const my = Math.round(f.main[mid + 1]!);
        // The glow is dithered like the nebula (Bayer 4×4), thinning out from the bolt's middle.
        const glow = { color: VIOLET_GLOW, alpha: 0.2 * level * k };
        for (let dy = -GLOW_R; dy <= GLOW_R; dy++) {
          for (let dx = -GLOW_R; dx <= GLOW_R; dx++) {
            const d = Math.hypot(dx, dy) / GLOW_R;
            if (d >= 1) continue;
            const t = BAYER4[((my + dy) & 3) * 4 + ((mx + dx) & 3)]! / 16;
            if (t < (1 - d) * (1 - d) * 0.75) g.rect(mx + dx, my + dy, 1, 1);
          }
        }
        g.fill(glow);
        for (const [line, width, color, alpha] of [
          [f.main, 3, VIOLET, a * 0.45],
          [f.side, 2, VIOLET, a * 0.35],
          [f.main, 1, VIOLET_CORE, a],
          [f.side, 1, VIOLET_CORE, a * 0.8],
        ] as const) {
          g.moveTo(Math.round(line[0]!), Math.round(line[1]!));
          for (let i = 2; i < line.length; i += 2) g.lineTo(Math.round(line[i]!), Math.round(line[i + 1]!));
          g.stroke({ width, color, alpha });
        }
      } else {
        // A glitch is on, then off: no fade.
        const a = 0.3 * level;
        for (let i = 0; i < f.main.length; i += 4) {
          const x = Math.round(f.main[i]!);
          const y = Math.round(f.main[i + 1]!);
          const w = Math.round(f.main[i + 2]!);
          const h = f.main[i + 3]!;
          g.rect(x, y, w, h).fill({ color: VIOLET, alpha: a * 0.3 });
          g.rect(x - 2, y, w, 1).fill({ color: CYAN, alpha: a });
          g.rect(x + 2, y + h - 1, w, 1).fill({ color: MAGENTA, alpha: a });
        }
        for (let i = 0; i < f.dots.length; i += 2) g.rect(Math.round(f.dots[i]!), Math.round(f.dots[i + 1]!), 1, 1).fill({ color: i % 4 ? CYAN : 0xf3f5ff, alpha: a });
      }
    }
  }

  return {
    id: 'boss-storm',
    level: stormLevel,
    get clock() {
      return clock;
    },
    get flashCount() {
      return flashCount;
    },
    update(dt, level, scene) {
      wall += dt;
      while (recent.length && recent[0]! <= wall - 1) recent.shift();
      if (level <= 0) {
        // Calm: the next Core's storm starts over.
        clock = 0;
        nextFlash = FIRST_FLASH;
        flashes.length = 0;
        return;
      }
      clock += dt;
      for (let i = flashes.length - 1; i >= 0; i--) if (clock - flashes[i]!.at >= flashes[i]!.life) flashes.splice(i, 1);
      if (scene.reduced) {
        flashes.length = 0;
        return;
      }
      moveField(dt, scene);
      if ((scene.biome === 'nebula' || scene.biome === 'rift') && clock >= nextFlash) {
        if (recent.length >= FLASH_CAP) {
          // Over the cap: try again in a moment.
          nextFlash = clock + 0.1;
          return;
        }
        startFlash(scene);
        // Fewer flashes while the storm is still rising. The rift's tears come in pairs now and then.
        const pace = 0.4 + 0.6 * level;
        nextFlash = clock + (scene.biome === 'rift' && rand() < 0.4 ? 0.14 : (scene.biome === 'nebula' ? 1.3 + rand() * 2.2 : 0.9 + rand() * 1.7) / pace);
      }
    },
    draw(g, level, scene) {
      if (level <= 0) return CALM;
      const breath = scene.reduced ? 0.85 : 0.78 + 0.22 * Math.sin((clock / VIGNETTE_PERIOD) * Math.PI * 2);
      vignette(g, scene, level * breath);
      if (!scene.reduced) {
        if (scene.boss) waves(g, scene, level);
        biomeTouch(g, scene, level);
        drawFlashes(g, scene, level);
      }
      return {
        cloud: CLOUD * level,
        color: scene.danger,
        light: 1 - DIM * level,
        veil: level,
        pull: !scene.reduced && scene.boss ? { x: scene.boss.x, y: scene.boss.y, px: PULL * level } : null,
      };
    },
  };
}

/** The environment's effects, in drawing order: a new world event is one more entry. */
export const ENVIRONMENT: readonly ((seed: number) => EnvironmentEffect)[] = [createBossStorm];

export interface Environment {
  readonly effects: readonly EnvironmentEffect[];
  /** One frame: every effect's level from `sim`, advanced by `dt` and drawn on `g`; their touch on the backdrop. */
  frame(sim: Sim, dt: number, scene: EnvScene, g: Painter): BackdropTouch;
}

/** Strongest cloud, darkest light and veil, the first pull. */
function combine(a: BackdropTouch, b: BackdropTouch): BackdropTouch {
  const cloud = b.cloud > a.cloud ? b : a;
  return { cloud: cloud.cloud, color: cloud.color, light: Math.min(a.light, b.light), veil: Math.max(a.veil, b.veil), pull: a.pull ?? b.pull };
}

/** Every ENVIRONMENT entry, live for one stage. */
export function createEnvironment(seed: number): Environment {
  const effects = ENVIRONMENT.map((make) => make(seed));
  return {
    effects,
    frame(sim, dt, scene, g) {
      let out = CALM;
      for (const e of effects) {
        const level = Math.min(1, Math.max(0, e.level(sim)));
        e.update(dt, level, scene);
        out = combine(out, e.draw(g, level, scene));
      }
      return out;
    },
  };
}
