import { expect, test } from 'vitest';
import { BIOMES, type BiomeId, botPick, createSim, DEFAULT_CONTENT, IDLE, killEnemy, type Sim, step } from '@galaxy/sim';
import {
  createBossStorm,
  createEnvironment,
  type EnvScene,
  FLASH_CAP,
  OVERLAY_MAX,
  type Painter,
  stormLevel,
} from '../src/arena/stage/environment';

// The arena's environment effects (plan «banda sonora, skins, perfil y entorno», part E), as pure state: the Núcleo's
// storm follows the simulation's phase alone (so a replay seeks right), it never flashes more than twice a second,
// nothing it draws is more opaque than the photosensitivity cap, and with reduced motion only a still tint and a still
// vignette remain.

type Op = { kind: 'rect' | 'circle' | 'line'; x: number; y: number; w: number; h: number; paint: 'fill' | 'stroke'; color: number; alpha: number };

/** A Painter that records what each shape was painted with (the shapes since the last fill or stroke). */
class Recorder implements Painter {
  ops: Op[] = [];
  private pending: Omit<Op, 'paint' | 'color' | 'alpha'>[] = [];
  rect(x: number, y: number, w: number, h: number) {
    this.pending.push({ kind: 'rect', x, y, w, h });
    return this;
  }
  circle(x: number, y: number, r: number) {
    this.pending.push({ kind: 'circle', x, y, w: r * 2, h: r * 2 });
    return this;
  }
  moveTo(x: number, y: number) {
    this.pending.push({ kind: 'line', x, y, w: 0, h: 0 });
    return this;
  }
  lineTo() {
    return this;
  }
  fill(style: { color: number; alpha: number }) {
    for (const s of this.pending) this.ops.push({ ...s, paint: 'fill', ...style });
    this.pending = [];
    return this;
  }
  stroke(style: { width: number; color: number; alpha: number }) {
    for (const s of this.pending) this.ops.push({ ...s, paint: 'stroke', color: style.color, alpha: style.alpha });
    this.pending = [];
    return this;
  }
}

const scene = (biome: BiomeId, reduced = false): EnvScene => ({
  left: 0,
  width: 640,
  height: 360,
  boss: { x: 460, y: 120 },
  danger: 0xff4d6d,
  biome,
  reduced,
});

/** 10 s of frames at an uneven rate (60, 144 and 30 fps in turn), as a real browser draws them. */
function* frames(seconds = 10): Generator<number> {
  const steps = [1 / 60, 1 / 144, 1 / 30];
  let t = 0;
  for (let k = 0; t < seconds; k++) {
    const dt = steps[k % steps.length]!;
    t += dt;
    yield dt;
  }
}

test('la tormenta no está en las oleadas, sube en 2 s de Núcleo y se apaga en 2 s tras caer', () => {
  expect(stormLevel({ phase: 'waves', phaseTick: 0 })).toBe(0);
  expect(stormLevel({ phase: 'waves', phaseTick: 9000 })).toBe(0);
  expect(stormLevel({ phase: 'boss', phaseTick: 0 })).toBe(0);
  expect(stormLevel({ phase: 'boss', phaseTick: 60 })).toBeCloseTo(0.5);
  expect(stormLevel({ phase: 'boss', phaseTick: 120 })).toBe(1);
  expect(stormLevel({ phase: 'boss', phaseTick: 9000 })).toBe(1);
  expect(stormLevel({ phase: 'beacon', phaseTick: 0 })).toBe(1);
  expect(stormLevel({ phase: 'beacon', phaseTick: 60 })).toBeCloseTo(0.5);
  expect(stormLevel({ phase: 'beacon', phaseTick: 120 })).toBe(0);
  expect(stormLevel({ phase: 'beacon', phaseTick: 9000 })).toBe(0);
});

test('en una partida de verdad, la tormenta sigue la fase: nada en las oleadas, llena con el Núcleo y fuera tras caer', () => {
  const content = structuredClone(DEFAULT_CONTENT);
  content.sectors[0]!.layerSeconds = 2;
  const sim = createSim({ seed: '9', content, sector: content.sectors[0]!.id, probes: [{ probe: 'lumen', relics: [] }] });
  sim.probes[0]!.hp = 1e9;
  const storm = createEnvironment(1).effects.find((e) => e.id === 'boss-storm')!;
  const advance = (n: number) => {
    for (let k = 0; k < n; k++) step(sim, [sim.status === 'choosing' ? { ...IDLE, pick: botPick(sim.probes[0]!.offer!) } : IDLE]);
  };
  const seen: number[] = [];
  while (sim.phase === 'waves') {
    seen.push(storm.level(sim));
    advance(1);
  }
  expect(Math.max(...seen)).toBe(0);
  expect(storm.level(sim)).toBe(0);
  advance(60);
  expect(storm.level(sim)).toBeCloseTo(0.5, 1);
  advance(60);
  expect(storm.level(sim)).toBe(1);
  const boss = sim.boss!.index;
  killEnemy(sim, boss, { probe: 0, weapon: null, relic: null, element: null });
  expect(sim.phase).toBe('beacon');
  expect(storm.level(sim)).toBe(1);
  advance(60);
  expect(storm.level(sim)).toBeCloseTo(0.5, 1);
  advance(60);
  expect(storm.level(sim)).toBe(0);
});

test('nunca hay más de 2 destellos en un mismo segundo, en ningún bioma', () => {
  for (const biome of BIOMES) {
    const storm = createBossStorm(7);
    const at: number[] = [];
    let seen = 0;
    for (const dt of frames()) {
      storm.update(dt, 1, scene(biome));
      for (; seen < storm.flashCount; seen++) at.push(storm.clock);
    }
    for (const t of at) expect(at.filter((s) => s >= t && s < t + 1).length).toBeLessThanOrEqual(FLASH_CAP);
    // The nebula's lightning and the rift's tears do flash; the other biomes have no flashes at all.
    if (biome === 'nebula' || biome === 'rift') expect(at.length).toBeGreaterThan(2);
    else expect(at).toHaveLength(0);
  }
  expect(FLASH_CAP).toBeLessThanOrEqual(2);
});

test('nada de la tormenta pasa de 0,35 de opacidad ni cubre la pantalla entera', () => {
  expect(OVERLAY_MAX).toBeLessThanOrEqual(0.35);
  for (const biome of BIOMES) {
    for (const reduced of [false, true]) {
      const storm = createBossStorm(3);
      const s = scene(biome, reduced);
      // The highest of every frame, checked once (an expect per drawn shape made this test the slowest of the suite).
      let max = 0;
      let cloud = 0;
      let veil = 0;
      let fill = 0;
      for (const dt of frames()) {
        const g = new Recorder();
        storm.update(dt, 1, s);
        const touch = storm.draw(g, 1, s);
        cloud = Math.max(cloud, touch.cloud);
        veil = Math.max(veil, touch.veil);
        for (const op of g.ops) {
          max = Math.max(max, op.alpha);
          if (op.paint === 'fill') fill = Math.max(fill, op.w * op.h);
        }
      }
      expect(cloud).toBeLessThanOrEqual(OVERLAY_MAX);
      expect(veil).toBeLessThanOrEqual(1);
      // Never a full-screen fill: the vignette is bands at the edges, a flash is local.
      expect(fill).toBeLessThan(s.width * s.height * 0.25);
      expect(max).toBeGreaterThan(0);
      expect(max).toBeLessThanOrEqual(OVERLAY_MAX);
    }
  }
});

test('la viñeta late despacio: como mucho una vez por segundo', () => {
  const storm = createBossStorm(5);
  const s = scene('ice');
  const outer: number[] = [];
  for (const dt of frames()) {
    const g = new Recorder();
    storm.update(dt, 1, s);
    storm.draw(g, 1, s);
    // The outermost band at the top: a rect at the field's top-left corner as wide as the field.
    const band = g.ops.find((o) => o.kind === 'rect' && o.x === s.left && o.y === 0 && o.w === s.width)!;
    outer.push(band.alpha);
  }
  let peaks = 0;
  for (let i = 1; i < outer.length - 1; i++) if (outer[i]! > outer[i - 1]! && outer[i]! >= outer[i + 1]!) peaks++;
  expect(peaks).toBeGreaterThan(0);
  expect(peaks).toBeLessThanOrEqual(10);
});

test('con movimiento reducido solo quedan el tinte y una viñeta quieta: sin partículas, destellos, ondas ni estrellas estiradas', () => {
  for (const biome of BIOMES) {
    const storm = createBossStorm(11);
    const s = scene(biome, true);
    let first: string | null = null;
    for (const dt of frames()) {
      const g = new Recorder();
      storm.update(dt, 1, s);
      const touch = storm.draw(g, 1, s);
      expect(touch.pull).toBeNull();
      expect(touch.cloud).toBeGreaterThan(0);
      // Only the vignette's bands, and the same every frame.
      expect(g.ops.every((o) => o.kind === 'rect' && o.color === s.danger)).toBe(true);
      const shot = JSON.stringify(g.ops);
      first ??= shot;
      expect(shot).toBe(first);
    }
    expect(storm.flashCount).toBe(0);
  }
});

test('sin tormenta no dibuja nada ni toca el fondo', () => {
  const env = createEnvironment(1);
  const sim = { phase: 'waves', phaseTick: 50 } as Sim;
  for (const biome of BIOMES) {
    const g = new Recorder();
    const touch = env.frame(sim, 1 / 60, scene(biome), g);
    expect(g.ops).toHaveLength(0);
    expect(touch).toMatchObject({ cloud: 0, light: 1, veil: 0, pull: null });
  }
});

test('con el Núcleo vivo, las estrellas se estiran hacia él y aparecen las ondas', () => {
  const storm = createBossStorm(2);
  const s = scene('ice');
  let touch = storm.draw(new Recorder(), 1, s);
  const g = new Recorder();
  for (let k = 0; k < 60; k++) storm.update(1 / 60, 1, s);
  touch = storm.draw(g, 1, s);
  expect(touch.pull).toMatchObject({ x: s.boss!.x, y: s.boss!.y });
  expect(touch.pull!.px).toBeGreaterThan(0);
  // A wave is a ring around the Core.
  expect(g.ops.some((o) => o.kind === 'circle' && o.paint === 'stroke' && o.x === s.boss!.x && o.y === s.boss!.y)).toBe(true);
  // With no Core to point at (it fell before this replay frame), no waves and no pull.
  const lost = { ...s, boss: null };
  const h = new Recorder();
  touch = storm.draw(h, 1, lost);
  expect(touch.pull).toBeNull();
  expect(h.ops.some((o) => o.kind === 'circle' && o.paint === 'stroke' && o.color === s.danger)).toBe(false);
});
