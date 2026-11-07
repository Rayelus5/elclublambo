import 'pixi.js/unsafe-eval';
import { AREA, type Content, SHOT, type Sim, type SimEvent } from '@galaxy/sim';
import { Application, BitmapFont, BitmapText, Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import { BAYER, buildAtlas, ditherTexture, fbm } from './atlas';
import { type Camera, cameraFor } from './camera';
import { createFx } from './fx';
import { CHUNK, terrainAt } from './terrain';

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
}

export interface Stage {
  readonly app: Application;
  render(sim: Sim, alpha: number): void;
  /** The events of one simulation step (call once per step, in order). */
  feed(events: readonly SimEvent[]): void;
  resize(w: number, h: number): void;
  camera(): Camera | null;
  destroy(): void;
}

const SHOT_SPRITE = ['bolt', 'lance', 'arc', 'drone-bolt', 'orb', 'drone', 'relic-ray', 'jet', 'quasar', 'chaos', 'reflected', 'blade'];
const ROTATES = new Set<number>([SHOT.bolt, SHOT.lance, SHOT.ray, SHOT.jet, SHOT.quasar]);
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

interface Warning {
  kind: 'charge' | 'burst' | 'explode';
  x: number;
  y: number;
  angle: number;
  radius: number;
  left: number;
  total: number;
}

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

  const atlas = buildAtlas();
  let w = app.renderer.width;
  let h = app.renderer.height;

  // Ground (screen space, at the camera's zoom): a sparse starfield in three brightnesses over the void, and a slow
  // nebula of seamless noise, dithered in deep violet and blue at very low contrast so sprites always pop.
  const starTex = ditherTexture(256, 256, (x, y) => {
    const r = ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0) % 10000;
    if (r < 6) return '#bfe3ff';
    if (r < 20) return '#8890c4';
    if (r < 46) return '#2a2f5e';
    return null;
  });
  const nebulaTex = ditherTexture(512, 512, (x, y) => {
    // Domain-warped noise: no visible lattice when it tiles.
    const wx = x + (fbm(x, y, 512, 91) - 0.5) * 140;
    const wy = y + (fbm(x + 37, y + 11, 512, 92) - 0.5) * 140;
    const n = fbm(wx, wy, 512, 7);
    const t = BAYER[(y % 4) * 4 + (x % 4)]! / 16;
    if (n > 0.66 && t < (n - 0.66) * 4) return '#251d5a';
    if (n > 0.56 && t < (n - 0.56) * 3) return '#171845';
    if (n < 0.3 && t < (0.3 - n) * 2) return '#0d1534';
    return null;
  });
  const ground = new TilingSprite({ texture: starTex, width: w, height: h });
  const nebula = new TilingSprite({ texture: nebulaTex, width: w, height: h });
  const world = new Container();
  const decor = new Container();
  const pickups = new Container();
  const areas = new Graphics();
  const warnings = new Graphics();
  const marks = new Graphics();
  const enemies = new Container();
  const probes = new Container();
  const shots = new Container();
  const particles = new Container();
  world.addChild(decor, pickups, areas, warnings, marks, enemies, probes, shots, particles);
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

  const dustDots = [0, 1, 2, 3, 4, 5].map((v) =>
    ditherTexture(3, 4, (x, y) => (((v + 1) >> (x + y * 2)) & 1 && (x === 0 || x === 2) ? '#8890c4' : null)),
  );
  const chunks = new Map<string, Container>();

  const fx = createFx(opts.reduced);
  const warns: Warning[] = [];
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
        for (const d of terrainAt(cx, cy, opts.seed)) {
          // Clouds live in the nebula layer; the chunks carry the rocks and the braille dust.
          if (d.kind === 'cloud') continue;
          const tex = d.kind === 'rock' ? atlas.frames['rock-' + (d.variant + 1)]![0]! : dustDots[d.variant]!;
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

  function drawWarnings(dt: number): void {
    warnings.clear();
    for (let i = warns.length - 1; i >= 0; i--) {
      const wv = warns[i]!;
      wv.left -= dt;
      if (wv.left <= 0) {
        warns.splice(i, 1);
        continue;
      }
      const k = 1 - wv.left / wv.total;
      const pulse = opts.reduced ? 0.4 : 0.3 + 0.2 * Math.sin(clock * 18);
      if (wv.kind === 'charge') {
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
      s.alpha = en.fuseT[i]! > 0 ? 0.5 + 0.5 * Math.sin(clock * 30) : en.hackT[i]! > 0 ? 0.75 : 1;
      s.tint = en.hackT[i]! > 0 ? 0xffc94a : opts.reduced && (en.elite[i] || en.boss[i]) ? 0xffd0dc : 0xffffff;
      const special = en.elite[i]! > 0 || en.boss[i] === 1;
      if (special) {
        marks.circle(x, y + en.radius[i]! * 0.6, en.radius[i]! + 2).stroke({ width: 1, color: 0xff4d6d, alpha: 0.55 });
        if (en.shield[i]! > 0) marks.circle(x, y, en.radius[i]! + 4).stroke({ width: 1, color: 0xbfe3ff, alpha: 0.8 });
      }
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
      const id = SHOT_SPRITE[kind] ?? 'bolt';
      const sp = shotPool.at(i);
      sp.texture = atlas.frames[id]![frameOf(id, i)]!;
      sp.anchor.set(0.5);
      sp.position.set(Math.round(lerp(s.px[i]!, s.x[i]!, alpha)), Math.round(lerp(s.py[i]!, s.y[i]!, alpha)));
      sp.rotation = ROTATES.has(kind) ? s.angle[i]! * STEP_RAD : kind === SHOT.blade ? s.reach[i]! * STEP_RAD + Math.PI / 2 : 0;
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
    feed(events) {
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
            warns.push({ kind: e.kind, x: e.x, y: e.y, angle: e.angle, radius: e.radius, left: e.ticks / 60, total: e.ticks / 60 });
            break;
          case 'bossDown':
            fx.burst(e.x, e.y, 0xffc94a, 40, 140);
            fx.burst(e.x, e.y, 0xff4d6d, 30, 100);
            fx.shake(6);
            break;
          case 'element':
            fx.burst(e.x, e.y, ELEMENT_COLOR[e.element] ?? 0xffffff, 2, 30);
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
      drawWarnings(dt);
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
      starTex.destroy(true);
      nebulaTex.destroy(true);
      for (const t of dustDots) t.destroy(true);
      app.destroy({ removeView: false }, { children: true });
    },
  };
}
