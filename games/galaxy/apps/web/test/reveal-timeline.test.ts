import type { PulledGalaxy, Tier } from '@galaxy/shared';
import { gsap } from 'gsap';
import { expect, test } from 'vitest';
import { buildScript } from '../src/scanner/pro/script';
import { buildTimeline, CINEMA, createRig, GRID, RING, ringSpot, SINGLE } from '../src/scanner/pro/timeline';

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

test('una mítica trae los rayos de luz detrás de su carta, como una legendaria', () => {
  const { rig, tl, script } = setup([pull('mythic')]);
  const face = script.faces[0]!;
  tl.time(face.at + 0.5);
  expect(rig.rays).toBeGreaterThan(0.5);
  const ten = setup([pull('common'), pull('mythic'), pull('common'), pull('rare'), pull('common'), pull('common'), pull('uncommon'), pull('common'), pull('epic'), pull('common')]);
  const solo = ten.script.faces.find((f) => f.slot === 9)!;
  ten.tl.time(solo.at + 0.5);
  expect(ten.rig.rays).toBeGreaterThan(0.5);
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

// A fusion (plan «fusión pro»): the galaxies going in appear round the core, circle it faster and closer, sink into it
// one by one, and the new card is born from it.
const five = (t: Tier): Tier[] => [t, t, t, t, t];
function fusion(result: Tier, inputs: Tier[], motion: 'full' | 'reduced' = 'full', surge = false) {
  const script = buildScript([pull(result)], { motion, surge, intro: 'fusion', inputs });
  const rig = createRig(script);
  const tl = buildTimeline(gsap, script, rig);
  const at = (label: string) => script.phases.find((p) => p.label === label)!;
  return { script, rig, tl, at };
}

test('una fusión: las que entran aparecen en anillo, giran cada vez más cerca, se hunden en el núcleo y la nueva nace de él', () => {
  const { rig, tl, at, script } = fusion('rare', five('uncommon'));
  for (const p of script.phases) expect(tl.labels[p.label]).toBeCloseTo(p.at, 6);
  tl.time(0);
  expect(rig.inputs).toHaveLength(5);
  expect(rig.inputs.every((i) => i.alpha === 0)).toBe(true);
  expect(rig.cards[0]!.alpha).toBe(0);
  tl.time(at('orbita').at);
  expect(rig.inputs.every((i) => i.alpha > 0.99)).toBe(true);
  expect(rig.ring).toBeCloseTo(1, 2);
  expect(rig.spin).toBeCloseTo(0, 6);
  tl.time(at('orbita').at + at('orbita').dur * 0.5);
  expect(rig.spin).toBeGreaterThan(0);
  expect(rig.ring).toBeLessThan(1);
  tl.time(at('colapso').at);
  expect(rig.ring).toBeCloseTo(RING.close, 2);
  expect(rig.trail).toBeCloseTo(1, 2);
  expect(rig.core).toBeGreaterThan(0.5);
  expect(rig.warp).toBe(0);
  tl.time(at('impacto').at);
  expect(rig.inputs.every((i) => i.absorb > 0.99 && i.alpha < 0.01)).toBe(true);
  expect(rig.core).toBeLessThan(0.2);
  tl.time(at('carta').at);
  const card = rig.cards[0]!;
  expect(card.x).toBeCloseTo(0, 2);
  expect(card.y).toBeCloseTo(0, 2);
  expect(card.scale).toBeLessThan(0.2);
  tl.time(at('espera-carta').at);
  expect(card.alpha).toBeCloseTo(1, 2);
  expect(card.rotY).toBeCloseTo(Math.PI, 2);
  expect(card.scale).toBeCloseTo(SINGLE.scale, 2);
  // Back to the start, as «Saltar» and the Ensayo seek.
  tl.time(0);
  expect(rig.inputs.every((i) => i.alpha === 0 && i.absorb === 0)).toBe(true);
  expect(rig.spin).toBe(0);
});

test('una fusión que asciende: el núcleo rompe al color real y destella una vez', () => {
  const { rig, tl, at, script } = fusion('legendary', five('epic'), 'full', true);
  tl.time(at('ascenso').at);
  expect(rig.trail).toBeCloseTo(1, 2);
  tl.time(at('colapso').at);
  expect(rig.trail).toBeCloseTo(2, 2);
  expect(script.flashes.filter((f) => f.at < at('colapso').at)).toHaveLength(1);
});

test('una fusión con movimiento reducido: sin giro, temblor ni destellos; las que entran se funden en el núcleo', () => {
  const { rig, tl, at, script } = fusion('rare', five('uncommon'), 'reduced');
  for (let t = 0; t <= script.duration; t += 0.05) {
    tl.time(t);
    expect(rig.spin).toBe(0);
    expect(rig.shake).toBe(0);
    expect(rig.flash).toBe(0);
  }
  tl.time(at('colapso').at);
  expect(rig.inputs.every((i) => i.alpha > 0.99)).toBe(true);
  tl.time(at('carta').at);
  expect(rig.inputs.every((i) => i.alpha < 0.01)).toBe(true);
  tl.time(at('espera-carta').at);
  expect(rig.cards[0]!.alpha).toBeCloseTo(1, 2);
  expect(rig.cards[0]!.rotY).toBeCloseTo(Math.PI, 2);
});

test('una fusión con movimiento reducido: cada carta se funde en su sitio, sin girar ni ir hacia el núcleo', () => {
  const at0 = ringSpot(2, 5, { ring: 1, spin: 0, absorb: 0 }, true);
  const sunk = ringSpot(2, 5, { ring: 1, spin: 0, absorb: 1 }, true);
  expect(sunk).toEqual(at0);
  // With full motion it swirls in and shrinks.
  const full = ringSpot(2, 5, { ring: 1, spin: 0, absorb: 0.9 }, false);
  expect(Math.hypot(full.x, full.y)).toBeLessThan(Math.hypot(at0.x, at0.y) * 0.2);
  expect(full.scale).toBeLessThan(at0.scale);
});

test('una fusión: la velocidad del giro va en el rig (las estelas se ven también en pausa) y nunca con movimiento reducido', () => {
  const { rig, tl, at } = fusion('epic', five('rare'));
  tl.time(at('orbita').at);
  expect(rig.whirl).toBeCloseTo(0, 3);
  tl.time(at('orbita').at + at('orbita').dur * 0.5);
  expect(rig.whirl).toBeGreaterThan(0.1);
  expect(rig.whirl).toBeLessThan(0.9);
  tl.time(at('colapso').at + 0.1);
  expect(rig.whirl).toBeCloseTo(1, 1);
  tl.time(at('carta').at);
  expect(rig.whirl).toBeCloseTo(0, 3);
  const calm = fusion('epic', five('rare'), 'reduced');
  for (let t = 0; t <= calm.script.duration; t += 0.05) {
    calm.tl.time(t);
    expect(calm.rig.whirl).toBe(0);
  }
});

test('una fusión: ir hacia delante o hacia atrás hasta el mismo momento deja el mismo rig', () => {
  const { rig, tl, script } = fusion('legendary', five('epic'), 'full', true);
  // To the millionth: GSAP's own arithmetic may differ in the last bits between the two ways in.
  const round = (v: object) => JSON.parse(JSON.stringify(v, (_, x: unknown) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x))) as unknown;
  const card = rig.cards[0]!;
  const pick = () =>
    round({
      ring: rig.ring,
      spin: rig.spin,
      core: rig.core,
      whirl: rig.whirl,
      trail: rig.trail,
      inputs: rig.inputs.map(({ alpha, absorb, glow }) => ({ alpha, absorb, glow })),
      card: { x: card.x, y: card.y, z: card.z, scale: card.scale, rotY: card.rotY, alpha: card.alpha },
    });
  for (const p of script.phases) {
    const t = p.at + p.dur * 0.5;
    tl.time(0);
    tl.time(t);
    const forward = pick();
    tl.time(script.duration);
    tl.time(t);
    expect(pick()).toEqual(forward);
  }
});
