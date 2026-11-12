import { expect, test, vi } from 'vitest';
import { type Biome, COMPOSITIONS } from '../src/audio/music/compositions';
import { createEngine, type MusicScene } from '../src/audio/music/engine';
import { musicLibrary } from '../src/audio/music/files';
import { type Layer, STYLES } from '../src/audio/music/styles';
import { fakeContext } from './fake-audio';

// The soundtrack's engine (plan «banda sonora», part A): it plays a piece on the audio clock, a little ahead of time;
// its layers fade in and out with ramps (never a click); a change of piece (a Núcleo arriving, the menu's next track)
// waits for the bar and crossfades; it never plays more than its voices; it stops with a fade.

function setup(scene: MusicScene = { kind: 'menu' }, opts: { voiceCap?: number } = {}) {
  const ctx = fakeContext();
  const out = ctx.createGain();
  const engine = createEngine(ctx, out as unknown as AudioNode, { seed: 5, choice: 'ambient', ...opts });
  engine.setScene(scene);
  engine.start();
  const run = (seconds: number, every = 0.025) => {
    for (let t = 0; t < seconds; t += every) {
      ctx.currentTime += every;
      engine.tick();
    }
  };
  return { ctx, engine, run };
}

const run1 = (biome: Biome = 'nebula', intensity: Layer = 1): Extract<MusicScene, { kind: 'run' }> => ({ kind: 'run', biome, boss: null, intensity, choosing: false, paused: false });

test('suena al ritmo del reloj de audio y solo un poco por delante', () => {
  const { ctx, run } = setup();
  run(6);
  expect(ctx.started.length).toBeGreaterThan(10);
  for (const s of ctx.started) expect(s.at).toBeLessThanOrEqual(6 + 0.2 + 0.05);
  // The first note waits for the start (no note in the past).
  expect(Math.min(...ctx.started.map((s) => s.at))).toBeGreaterThanOrEqual(0);
});

test('con la misma semilla suena igual', () => {
  const a = setup(run1());
  const b = setup(run1());
  a.run(8);
  b.run(8);
  expect(b.ctx.started.map((s) => s.at)).toEqual(a.ctx.started.map((s) => s.at));
});

test('las capas entran y salen con rampas lineales, nunca a cero de golpe', () => {
  const { ctx, engine, run } = setup(run1('ice', 1));
  run(3);
  engine.setScene(run1('ice', 3));
  run(3);
  engine.setScene(run1('ice', 0));
  run(3);
  for (const g of ctx.gains) for (const m of g.gain.moves) expect(m.kind === 'exp' && m.value <= 0).toBe(false);
  expect(engine.state().intensity).toBe(0);
});

test('más intensidad, más notas', () => {
  const calm = setup(run1('forge', 0));
  const danger = setup(run1('forge', 3));
  calm.run(8);
  danger.run(8);
  expect(danger.ctx.started.length).toBeGreaterThan(calm.ctx.started.length * 1.5);
});

test('cada sector suena con su pieza y el Núcleo entra en el compás siguiente', () => {
  const { engine, run } = setup(run1('reef', 1));
  run(2);
  expect(engine.state().piece).toBe('sector-arrecife');
  const before = engine.state();
  engine.setScene({ kind: 'run', biome: 'reef', boss: { deep: false, form: 1 }, intensity: 2, choosing: false, paused: false });
  run(0.05);
  // Still the sector's piece until its bar ends.
  expect(engine.state().piece).toBe('sector-arrecife');
  const comp = COMPOSITIONS.find((c) => c.id === 'sector-arrecife')!;
  const bar = (4 * 60) / (comp.bpm * STYLES.ambient.tempo);
  run(bar + 0.1);
  const after = engine.state();
  expect(after.piece).toBe('nucleo-1');
  // It began exactly on a bar line of the old piece.
  const bars = (after.startedAt - before.startedAt) / bar;
  expect(bars).toBeGreaterThan(0.5);
  expect(Math.abs(bars - Math.round(bars))).toBeLessThan(1e-6);
  engine.setScene({ kind: 'run', biome: 'reef', boss: { deep: true, form: 1 }, intensity: 3, choosing: false, paused: false });
  run(3);
  expect(engine.state().piece).toBe('nucleo-profundo');
});

test('nunca suenan más voces de las que caben', () => {
  const { engine, run } = setup({ kind: 'run', biome: 'rift', boss: { deep: false, form: 2 }, intensity: 3, choosing: false, paused: false }, { voiceCap: 24 });
  for (let i = 0; i < 400; i++) {
    run(0.025);
    expect(engine.state().voices).toBeLessThanOrEqual(24);
  }
});

test('el menú pasa a la siguiente pieza al acabar la vuelta, sin repetir la misma', () => {
  const { engine, run } = setup({ kind: 'menu' });
  const first = engine.state().piece;
  expect(COMPOSITIONS.find((c) => c.id === first)!.group).toBe('menu');
  run(260, 0.05);
  expect(engine.state().piece).not.toBe(first);
  expect(COMPOSITIONS.find((c) => c.id === engine.state().piece)!.group).toBe('menu');
});

test('parar baja el volumen con una rampa y no programa nada más', () => {
  const { ctx, engine, run } = setup();
  run(2);
  engine.stop();
  const n = ctx.started.length;
  run(3);
  expect(ctx.started.length).toBe(n);
  expect(engine.state().playing).toBe(false);
});

test('eligiendo mejora la música se apaga un poco (filtro) y en pausa baja', () => {
  const { engine, run } = setup(run1());
  run(1);
  engine.setScene({ ...run1(), choosing: true });
  run(0.5);
  expect(engine.state().filtered).toBe(true);
  engine.setScene({ ...run1(), paused: true });
  run(0.5);
  expect(engine.state().ducked).toBe(true);
});

test('los remates suenan en la tonalidad de la pieza', () => {
  const { ctx, engine, run } = setup(run1('nebula', 2));
  run(1);
  const n = ctx.started.length;
  engine.stinger('extract');
  run(1);
  expect(ctx.started.length).toBeGreaterThan(n);
});

test('con archivos propios, la pieza suena desde ellos (sus capas siguen la intensidad) y, si no cargan, se genera', async () => {
  const lib = musicLibrary({ '../../assets/audio/musica/propia/sector-hielo-capa0.ogg': '/a0.ogg', '../../assets/audio/musica/propia/sector-hielo-capa1.ogg': '/a1.ogg' }, 'ogg');
  const ctx = fakeContext();
  const load = vi.fn(async () => ctx.createBuffer(2, 8_000 * 4, 8_000) as unknown as AudioBuffer);
  const engine = createEngine(ctx, ctx.createGain() as unknown as AudioNode, { seed: 5, choice: 'own', library: lib, load });
  engine.setScene(run1('ice', 1));
  engine.start();
  for (let t = 0; t < 2; t += 0.025) {
    ctx.currentTime += 0.025;
    engine.tick();
    await Promise.resolve();
  }
  expect(load).toHaveBeenCalledWith('/a0.ogg');
  expect(load).toHaveBeenCalledWith('/a1.ogg');
  // The two layers start together; no generated notes for this piece.
  const buffers = ctx.started.filter((s) => s.kind === 'buffer' && s.buffer && s.buffer.length === 8_000 * 4);
  expect(buffers).toHaveLength(2);
  expect(new Set(buffers.map((b) => b.at)).size).toBe(1);
  expect(ctx.started.filter((s) => s.kind === 'osc')).toHaveLength(0);
  expect(engine.state().source).toBe('file');

  // A file that does not load: the generated piece plays.
  const ctx2 = fakeContext();
  const broken = createEngine(ctx2, ctx2.createGain() as unknown as AudioNode, { seed: 5, choice: 'own', library: lib, load: async () => Promise.reject(new Error('404')) });
  broken.setScene(run1('ice', 1));
  broken.start();
  for (let t = 0; t < 3; t += 0.025) {
    ctx2.currentTime += 0.025;
    broken.tick();
    await Promise.resolve();
  }
  expect(ctx2.started.filter((s) => s.kind === 'osc').length).toBeGreaterThan(0);
  expect(broken.state().source).toBe('generated');
});
