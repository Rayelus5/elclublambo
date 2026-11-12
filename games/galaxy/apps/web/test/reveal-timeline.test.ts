import type { PulledGalaxy, Tier } from '@galaxy/shared';
import { gsap } from 'gsap';
import { expect, test } from 'vitest';
import { buildScript } from '../src/scanner/pro/script';
import { buildTimeline, CINEMA, createRig, GRID, SINGLE } from '../src/scanner/pro/timeline';

// The pro scanner's timeline (plan «escáner pro», part B): one paused GSAP timeline, built from the script, that moves
// a plain «rig» of numbers the 3D scene and the overlays read every frame. Real GSAP: its labels sit where the script
// says, and seeking anywhere (forwards or back, as «Seguir» and «Saltar» do) leaves the rig as that moment shows it.

let n = 0;
function pull(tier: Tier, extra: Partial<PulledGalaxy> = {}): PulledGalaxy {
  n++;
  return { id: `id-${n}`, seed: String(n), tier, finish: 'normal', traits: { phenomenon: 'none' }, name: `G${n}`, designation: `D${n}`, featured: false, ...extra };
}

function setup(pulls: PulledGalaxy[], motion: 'full' | 'reduced' = 'full', surge = false) {
  const script = buildScript(pulls, { motion, surge });
  const rig = createRig(script);
  const tl = buildTimeline(gsap, script, rig);
  const at = (label: string) => script.phases.find((p) => p.label === label)!;
  return { script, rig, tl, at };
}

test('las etiquetas de la línea de tiempo están donde dice el guion', () => {
  const { script, tl } = setup([pull('legendary', { traits: { phenomenon: 'comet' } })], 'full', true);
  for (const p of script.phases) expect(tl.labels[p.label]).toBeCloseTo(p.at, 6);
  expect(tl.paused()).toBe(true);
  expect(tl.duration()).toBeGreaterThanOrEqual(script.duration - 1e-6);
});

test('una tirada: negro y bandas cerradas, formato cine, salto, caída, carta girada y resumen', () => {
  const { rig, tl, at, script } = setup([pull('epic')]);
  tl.time(0);
  expect(rig.bars).toBe(1);
  expect(rig.black).toBe(1);
  tl.time(at('salto').at);
  expect(rig.bars).toBeCloseTo(CINEMA, 2);
  expect(rig.black).toBeCloseTo(0, 2);
  tl.time(at('caida').at);
  expect(rig.warp).toBeCloseTo(1, 2);
  expect(rig.trail).toBeCloseTo(1, 2);
  tl.time(at('impacto').at);
  expect(rig.warp).toBeCloseTo(0, 2);
  expect(rig.meteor).toBeCloseTo(1, 2);
  tl.time(at('espera-carta').at);
  const card = rig.cards[0]!;
  expect(card.alpha).toBeCloseTo(1, 2);
  expect(card.rotY).toBeCloseTo(Math.PI, 2);
  expect(card.x).toBeCloseTo(SINGLE.x, 2);
  expect(card.scale).toBeCloseTo(SINGLE.scale, 2);
  expect(rig.title).toBeCloseTo(1, 2);
  expect(rig.stamp).toBeCloseTo(1, 2);
  expect(rig.focus).toBe(0);
  tl.time(script.duration);
  expect(rig.summary).toBeCloseTo(1, 2);
  expect(rig.bars).toBeCloseTo(0, 2);
});

test('volver atrás deja el rig como al principio (Saltar y Seguir saltan por la línea)', () => {
  const { rig, tl, script } = setup([pull('rare')]);
  tl.time(script.duration);
  tl.time(0);
  expect(rig.bars).toBe(1);
  expect(rig.black).toBe(1);
  expect(rig.cards[0]!.alpha).toBe(0);
  expect(rig.cards[0]!.rotY).toBe(0);
  expect(rig.summary).toBe(0);
  expect(rig.focus).toBe(-1);
});

test('el ascenso cambia la estela al color real y destella una vez', () => {
  const { rig, tl, at, script } = setup([pull('legendary')], 'full', true);
  const up = at('ascenso');
  tl.time(up.at);
  expect(rig.trail).toBeCloseTo(1, 2);
  tl.time(up.at + up.dur);
  expect(rig.trail).toBeCloseTo(2, 2);
  const flash = script.flashes.find((f) => f.color === 'legendary' && f.at < at('caida').at)!;
  tl.time(flash.at + 0.05);
  expect(rig.flash).toBeCloseTo(flash.alpha, 1);
  expect(rig.flashColor).toBe('legendary');
  tl.time(flash.at + 0.6);
  expect(rig.flash).toBeCloseTo(0, 2);
});

test('diez: reparto en la rejilla boca abajo, cascada de giros, primeros planos que vuelven a su sitio', () => {
  const pulls = [pull('common'), pull('legendary'), pull('common'), pull('rare'), pull('common'), pull('common'), pull('uncommon'), pull('common'), pull('epic'), pull('common')];
  const { rig, tl, at, script } = setup(pulls);
  tl.time(at('giro-0').at);
  rig.cards.forEach((c, slot) => {
    expect(c.alpha).toBeCloseTo(1, 2);
    expect(c.rotY).toBeCloseTo(0, 2);
    expect(c.x).toBeCloseTo(GRID.x(slot), 2);
    expect(c.y).toBeCloseTo(GRID.y(slot), 2);
  });
  const solo = at('solo-9');
  const face = script.faces.find((f) => f.slot === 9)!;
  tl.time(face.at + 0.5);
  expect(rig.focus).toBe(9);
  expect(rig.dim).toBeGreaterThan(0.5);
  expect(rig.cards[9]!.x).toBeCloseTo(0, 1);
  expect(rig.cards[9]!.scale).toBeGreaterThan(GRID.scale);
  tl.time(solo.at + solo.dur);
  expect(rig.cards[9]!.x).toBeCloseTo(GRID.x(9), 2);
  expect(rig.cards[9]!.scale).toBeCloseTo(GRID.scale, 2);
  expect(rig.dim).toBeCloseTo(0, 2);
  tl.time(at('final').at + 0.4);
  rig.cards.forEach((c) => expect(c.rotY).toBeCloseTo(Math.PI, 2));
});

test('movimiento reducido: ni salto ni temblor ni destellos; las cartas aparecen y se descubren con fundidos', () => {
  const { rig, tl, at, script } = setup([pull('legendary')], 'reduced');
  for (let t = 0; t <= script.duration; t += 0.05) {
    tl.time(t);
    expect(rig.warp).toBe(0);
    expect(rig.shake).toBe(0);
    expect(rig.flash).toBe(0);
  }
  tl.time(at('espera-carta').at);
  expect(rig.cards[0]!.rotY).toBeCloseTo(Math.PI, 2);
  expect(rig.cards[0]!.alpha).toBeCloseTo(1, 2);
});
