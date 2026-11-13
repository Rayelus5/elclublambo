import type { PulledGalaxy, Tier } from '@galaxy/shared';
import { expect, test, vi } from 'vitest';
import type { Bank } from '../src/audio/bank';
import type { Score } from '../src/audio/score';
import { createClock } from '../src/scanner/pro/clock';
import type { CueOpts, ProSound } from '../src/scanner/pro/cues';
import { createPlayer, GUARD_SEEK_MS, GUARD_START_MS, IMAGE_WAIT_MS } from '../src/scanner/pro/player';
import { buildScript, type Phase } from '../src/scanner/pro/script';
import { createRig } from '../src/scanner/pro/timeline';
import { fakeContext } from './fake-audio';

// The pro scanner's player (plan «escáner pro», part B): it waits where the script waits (the single card; a card whose
// image is late, up to 4 s), «Seguir» and «Saltar» move through it (never twice in a row by accident), and the sounds
// land on the audio clock at their moment — skipping past a reveal still lets it be heard, once.

let n = 0;
function pull(tier: Tier, extra: Partial<PulledGalaxy> = {}): PulledGalaxy {
  n++;
  return { id: `p-${n}`, seed: String(n), tier, finish: 'normal', traits: { phenomenon: 'none' }, name: `G${n}`, designation: `D${n}`, featured: false, ...extra };
}

function harness(pulls: PulledGalaxy[], opts: { ready?: (slot: number) => boolean } = {}) {
  const script = buildScript(pulls, { motion: 'full', surge: false });
  const rig = createRig(script);
  let real = 0;
  let audioNow = 0;
  const clock = createClock(() => real / 1000);
  const ctx = fakeContext();
  Object.defineProperty(ctx, 'currentTime', { get: () => audioNow });
  const plays: { id: ProSound; at: number; opts: CueOpts }[] = [];
  const bank = { play: (id: ProSound, at: number, _out: AudioNode, o: CueOpts) => plays.push({ id, at, opts: o }), preload: async () => {}, fromFile: () => false } as unknown as Bank<ProSound, CueOpts>;
  const phases: string[] = [];
  const faces: number[] = [];
  const waits: boolean[] = [];
  const player = createPlayer({
    script,
    rig,
    timeline: { time: () => {} },
    clock,
    audio: { ctx, sfx: ctx.destination as unknown as AudioNode, music: ctx.destination as unknown as AudioNode },
    bank,
    ready: opts.ready,
    onPhase: (p: Phase) => phases.push(p.label),
    onFace: (f) => faces.push(f.slot),
    onWait: (w) => waits.push(w),
    raf: () => 1,
    caf: () => {},
    now: () => real,
  });
  const step = (ms: number) => {
    // The real clock and the audio clock move together; one frame every ~16 ms.
    for (let left = ms; left > 0; left -= 16) {
      real += Math.min(16, left);
      audioNow += Math.min(16, left) / 1000;
      player.frame();
    }
  };
  const at = (label: string) => script.phases.find((p) => p.label === label)!;
  return { script, player, clock, step, plays, phases, faces, waits, at, real: () => real };
}

test('una tirada se detiene en la carta hasta que el jugador sigue, y Seguir va al resumen', () => {
  const h = harness([pull('rare')]);
  h.player.start();
  h.step(20_000);
  expect(h.clock.now()).toBeCloseTo(h.at('espera-carta').at, 6);
  expect(h.phases).toEqual(['ignicion', 'salto', 'caida', 'impacto', 'carta', 'espera-carta']);
  expect(h.faces).toEqual([0]);
  expect(h.player.advance()).toBe(true);
  expect(h.clock.now()).toBeCloseTo(h.at('resumen').at, 6);
  h.step(2_000);
  expect(h.phases.at(-1)).toBe('resumen');
  expect(h.clock.now()).toBeCloseTo(h.script.duration, 6);
});

test('Seguir se ignora justo al empezar y justo después de otro salto', () => {
  const h = harness([pull('epic')]);
  h.player.start();
  h.step(GUARD_START_MS - 100);
  expect(h.player.advance()).toBe(false);
  h.step(200);
  expect(h.player.advance()).toBe(true);
  expect(h.clock.now()).toBeCloseTo(h.at('carta').at, 6);
  h.step(GUARD_SEEK_MS - 100);
  expect(h.player.advance()).toBe(false);
  h.step(200);
  expect(h.player.advance()).toBe(true);
  expect(h.clock.now()).toBeCloseTo(h.at('espera-carta').at, 6);
});

test('Saltar va al resumen y solo suena el acorde final', () => {
  const h = harness([pull('legendary')]);
  h.player.start();
  h.step(GUARD_START_MS + 50);
  h.plays.length = 0;
  expect(h.player.skip()).toBe(true);
  expect(h.clock.now()).toBeCloseTo(h.at('resumen').at, 6);
  h.step(300);
  expect(h.plays.map((p) => p.id)).toEqual(['resumen']);
  expect(h.player.skip()).toBe(false);
});

test('saltar por encima de la revelación aún la deja oír, una vez', () => {
  const h = harness([pull('epic', { featured: true })]);
  h.player.start();
  const carta = h.at('carta');
  h.step(GUARD_START_MS + 50);
  h.player.seek(carta.at + 0.05);
  h.plays.length = 0;
  h.step(GUARD_SEEK_MS + 20);
  h.player.advance();
  // From early in the card's phase to its wait: the face and «Destacada» are heard, once each.
  const ids = h.plays.map((p) => p.id);
  expect(ids.filter((x) => x === 'revelar')).toHaveLength(1);
  expect(ids.filter((x) => x === 'destacada')).toHaveLength(1);
});

test('los sonidos se programan en el reloj de audio, en su momento', () => {
  const h = harness([pull('common')]);
  h.player.start();
  h.step(3_000);
  const impacto = h.script.cues.find((c) => c.id === 'impacto')!;
  h.step(3_000);
  const played = h.plays.find((p) => p.id === 'impacto')!;
  expect(played.at).toBeCloseTo(impacto.at, 1);
  const salto = h.plays.find((p) => p.id === 'salto')!;
  expect(salto.opts.dur).toBeGreaterThan(1);
});

test('una carta cuya imagen no ha llegado espera, y gira igualmente a los 4 s', () => {
  let ready = false;
  const h = harness([pull('rare')], { ready: () => ready });
  h.player.start();
  h.step(6_000);
  const face = h.script.faces[0]!.at;
  expect(h.clock.now()).toBeLessThan(face);
  expect(h.waits).toContain(true);
  h.step(IMAGE_WAIT_MS);
  h.step(3_000);
  expect(h.clock.now()).toBeCloseTo(h.at('espera-carta').at, 6);
  expect(h.waits.at(-1)).toBe(false);
  // And with the image in time, nothing waits.
  ready = true;
  const h2 = harness([pull('rare')], { ready: () => true });
  h2.player.start();
  h2.step(15_000);
  expect(h2.waits).toEqual([]);
});

test('diez: sin esperas por el camino, hasta el resumen; Seguir salta al siguiente primer plano', () => {
  const pulls = [pull('common'), pull('epic'), pull('common'), pull('common'), pull('legendary'), pull('common'), pull('uncommon'), pull('common'), pull('rare'), pull('common')];
  const h = harness(pulls);
  h.player.start();
  h.step(GUARD_START_MS + 50);
  h.player.advance();
  expect(h.clock.now()).toBeCloseTo(h.at('reparto').at, 6);
  h.step(GUARD_SEEK_MS + 50);
  h.player.advance();
  expect(h.clock.now()).toBeCloseTo(h.at('solo-8').at, 6);
  h.step(40_000);
  expect(h.clock.now()).toBeCloseTo(h.script.duration, 6);
  // The faces jumped over are not announced one by one (the summary lists them).
  expect(h.faces).toEqual([7, 8, 9]);
});

// Plan «rareza Mítica» M2: in a mythic's held breath the music ducks (and comes back for the impact) and no sound plays;
// a jump lets the music up again at once. A legendary's music never ducks.
function fakeScore() {
  const calls: { kind: string; at: number; dur?: number; level?: number }[] = [];
  let started = false;
  const score: Score = {
    start: (at) => {
      started = true;
      calls.push({ kind: 'start', at });
    },
    level: (level, at) => calls.push({ kind: 'level', at, level }),
    stop: (at) => calls.push({ kind: 'stop', at }),
    duck: (at, dur) => calls.push({ kind: 'duck', at, dur }),
    unduck: (at) => calls.push({ kind: 'unduck', at }),
    get started() {
      return started;
    },
  };
  return { score, calls };
}

test('en el silencio de una mítica la música se agacha y no suena nada; una legendaria no la agacha', () => {
  const h = harness([pull('mythic')]);
  const { score, calls } = fakeScore();
  h.player.setScore(score);
  h.player.start();
  h.step(20_000);
  const hush = h.at('silencio');
  const ducks = calls.filter((c) => c.kind === 'duck');
  expect(ducks).toHaveLength(1);
  expect(ducks[0]!.at).toBeCloseTo(hush.at, 1);
  expect(ducks[0]!.dur).toBeCloseTo(hush.dur, 6);
  expect(h.plays.filter((p) => p.at > hush.at + 1e-6 && p.at < hush.at + hush.dur - 1e-6)).toEqual([]);
  // The mythic's own layer joins with its face.
  expect(calls.filter((c) => c.kind === 'level').at(-1)!.level).toBe(4);
  const l = harness([pull('legendary')]);
  const other = fakeScore();
  l.player.setScore(other.score);
  l.player.start();
  l.step(20_000);
  expect(other.calls.filter((c) => c.kind === 'duck')).toEqual([]);
});

test('saltar desde el silencio de una mítica levanta la música enseguida', () => {
  const h = harness([pull('mythic')]);
  const { score, calls } = fakeScore();
  h.player.setScore(score);
  h.player.start();
  const hush = h.at('silencio');
  h.step(Math.round((hush.at + 0.2) * 1000));
  expect(calls.some((c) => c.kind === 'duck')).toBe(true);
  h.player.seek(h.at('carta').at);
  expect(calls.some((c) => c.kind === 'unduck')).toBe(true);
  // Landing in the middle of the silence (the Ensayo's «ir a la fase») ducks it for what is left of it.
  calls.length = 0;
  h.player.seek(hush.at + 0.3);
  const duck = calls.find((c) => c.kind === 'duck')!;
  expect(duck.dur).toBeCloseTo(hush.dur - 0.3, 6);
});

test('la pausa (pestaña oculta) detiene el tiempo', () => {
  const h = harness([pull('common')]);
  h.player.start();
  h.step(1_000);
  const t = h.clock.now();
  h.player.pause();
  h.step(5_000);
  expect(h.clock.now()).toBeCloseTo(t, 6);
  h.player.resume();
  h.step(500);
  expect(h.clock.now()).toBeGreaterThan(t);
  vi.restoreAllMocks();
});
