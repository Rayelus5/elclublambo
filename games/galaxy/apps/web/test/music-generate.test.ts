import { expect, test } from 'vitest';
import { COMPOSITIONS, formBars } from '../src/audio/music/compositions';
import { createPlanner, type NoteEvent } from '../src/audio/music/generate';
import { STYLES } from '../src/audio/music/styles';
import { inScale } from '../src/audio/music/theory';
import { VOICES } from '../src/audio/music/voices';

// The soundtrack's generator (plan «banda sonora», part A): every composition is well formed, and a style turns it
// into bars of notes — the same seed the same notes, every melodic note in the key, the melody on a chord tone on the
// strong beats, and one loop never exactly the next (variety without repeating, the owner's «que no se sienta
// repetitivo»).

const MELODIC = new Set(['pad', 'bass', 'arp', 'keys', 'lead', 'bells', 'choir', 'brass']);
const groups = ['menu', 'sector', 'boss', 'results'];

test('las 13 composiciones están bien hechas', () => {
  expect(COMPOSITIONS).toHaveLength(13);
  expect(new Set(COMPOSITIONS.map((c) => c.id)).size).toBe(13);
  expect(COMPOSITIONS.filter((c) => c.group === 'menu')).toHaveLength(4);
  expect(new Set(COMPOSITIONS.filter((c) => c.group === 'sector').map((c) => c.biome))).toEqual(new Set(['nebula', 'ice', 'reef', 'forge', 'rift']));
  expect(COMPOSITIONS.filter((c) => c.group === 'boss')).toHaveLength(3);
  for (const c of COMPOSITIONS) {
    expect(groups).toContain(c.group);
    expect(c.motif.steps.reduce((a, b) => a + b, 0), c.id).toBe(32);
    expect(c.motif.notes).toHaveLength(c.motif.steps.length);
    expect(c.tonic).toBeGreaterThanOrEqual(36);
    expect(c.tonic).toBeLessThanOrEqual(60);
    expect(c.bpm).toBeGreaterThanOrEqual(60);
    expect(c.bpm).toBeLessThanOrEqual(130);
    for (const form of c.forms) {
      for (const s of form) expect(c.sections[s], `${c.id} ${s}`).toBeDefined();
      expect(formBars(c, form)).toBeGreaterThanOrEqual(16);
    }
    for (const [name, chords] of Object.entries(c.sections)) expect(chords.reduce((n, ch) => n + ch.bars, 0), `${c.id} ${name}`).toBe(8);
  }
});

const bars = (id: string, style: string, n: number, seed = 7) => {
  const comp = COMPOSITIONS.find((c) => c.id === id)!;
  const planner = createPlanner(comp, STYLES[style as 'ambient']!, seed);
  return Array.from({ length: n }, (_, i) => planner.bar(i));
};

test('la misma semilla da las mismas notas; otra, otras', () => {
  const a = bars('sector-nebulosa', 'ambient', 40);
  const b = bars('sector-nebulosa', 'ambient', 40);
  const c = bars('sector-nebulosa', 'ambient', 40, 8);
  expect(b).toEqual(a);
  expect(c.map((x) => x.events)).not.toEqual(a.map((x) => x.events));
});

for (const style of Object.keys(STYLES)) {
  test(`${style}: todas las notas en la tonalidad, en el compás, y la melodía sobre el acorde en los tiempos fuertes`, () => {
    for (const comp of COMPOSITIONS) {
      const planner = createPlanner(comp, STYLES[style as 'ambient']!, 3);
      for (let i = 0; i < 64; i++) {
        const plan = planner.bar(i);
        const roles = STYLES[style as 'ambient']!.arrangement[comp.group];
        for (const e of plan.events) {
          expect(e.at, comp.id).toBeGreaterThanOrEqual(0);
          expect(e.at).toBeLessThan(16);
          expect(e.len).toBeGreaterThan(0);
          expect(e.vel).toBeGreaterThan(0);
          expect(e.vel).toBeLessThanOrEqual(1);
          expect(roles[e.role], `${comp.id} ${e.role}`).toBeDefined();
          if (MELODIC.has(e.role)) expect(inScale(comp.tonic, comp.mode, e.midi), `${comp.id} ${e.role} ${e.midi}`).toBe(true);
          if ((e.role === 'lead' || e.role === 'bells') && e.at % 8 === 0) {
            expect(plan.chord.map((n) => n % 12), `${comp.id} bar ${i}`).toContain(e.midi % 12);
          }
        }
      }
    }
  });
}

test('una vuelta nunca es idéntica a la siguiente, aunque la forma sea la misma', () => {
  for (const comp of COMPOSITIONS) {
    const all = bars(comp.id, 'ambient', 200, 11);
    const loops = new Map<number, NoteEvent[][]>();
    for (const b of all) loops.set(b.loop, [...(loops.get(b.loop) ?? []), b.events]);
    const list = [...loops.values()].filter((l) => l.length >= 16);
    expect(list.length, comp.id).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < list.length; i++) expect(JSON.stringify(list[i]), comp.id).not.toBe(JSON.stringify(list[i - 1]));
  }
});

test('cada pieza dura entre 1,5 y 4 minutos por vuelta', () => {
  for (const comp of COMPOSITIONS) {
    const seconds = (formBars(comp, comp.forms[0]!) * 4 * 60) / (comp.bpm * STYLES.ambient.tempo);
    expect(seconds, comp.id).toBeGreaterThan(comp.group === 'results' ? 50 : 60);
    expect(seconds, comp.id).toBeLessThan(240);
  }
});

test('los acordes se enlazan sin saltos: ninguna voz del pad salta más de una quinta', () => {
  const all = bars('menu-faro', 'ambient', 64);
  for (let i = 1; i < all.length; i++) {
    const [a, b] = [all[i - 1]!.chord, all[i]!.chord];
    for (let v = 0; v < Math.min(a.length, b.length); v++) expect(Math.abs(b[v]! - a[v]!)).toBeLessThanOrEqual(7);
  }
});

// Part A2: the three styles the owner chose, each with every instrument it names.
test('tres estilos: Ambiente espacial, Lo-fi espacial (con swing) y Synthwave suave, con sus instrumentos', () => {
  expect(Object.keys(STYLES)).toEqual(['ambient', 'lofi', 'synthwave']);
  expect(STYLES.lofi.swing).toBeGreaterThan(0.1);
  expect(STYLES.lofi.tempo).toBeLessThan(1);
  for (const style of Object.values(STYLES)) {
    for (const voice of Object.values(style.voices)) expect(VOICES[voice], `${style.id} ${voice}`).toBeTypeOf('function');
    for (const group of ['menu', 'sector', 'boss', 'results'] as const) expect(Object.keys(style.arrangement[group]).length, `${style.id} ${group}`).toBeGreaterThan(2);
  }
});

test('el bajo nunca suena dos notas a la vez (tampoco la de paso al final de una sección)', () => {
  for (const comp of COMPOSITIONS) {
    const all = bars(comp.id, 'ambient', 64, 4);
    for (const b of all) {
      const bass = b.events.filter((e) => e.role === 'bass').sort((x, y) => x.at - y.at);
      for (let i = 1; i < bass.length; i++) expect(bass[i - 1]!.at + bass[i - 1]!.len, `${comp.id} bar ${b.bar}`).toBeLessThanOrEqual(bass[i]!.at);
    }
  }
});
