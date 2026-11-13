import { TIERS, type PulledGalaxy, type Tier } from '@galaxy/shared';
import { expect, test } from 'vitest';
import { buildScript, GUION, maxFlashesPerSecond, nextStop, phaseAt, surgeRoll } from '../src/scanner/pro/script';

// The pro scanner's script (plan «escáner pro», part B): the whole cinematic as data — phases with their labels and
// times, the sounds on them, the flashes, the music's layers and where «Seguir» lands — so the rhythm is tested and
// the owner can direct it number by number.

let n = 0;
function pull(tier: Tier, extra: Partial<PulledGalaxy> = {}): PulledGalaxy {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    seed: String(1000 + n),
    tier,
    finish: 'normal',
    traits: { phenomenon: 'none' },
    name: `Galaxia ${n}`,
    designation: `ECN-${n}`,
    featured: false,
    ...extra,
  };
}
const labels = (s: ReturnType<typeof buildScript>) => s.phases.map((p) => p.label);
const ids = (s: ReturnType<typeof buildScript>) => s.cues.map((c) => c.id);
const phase = (s: ReturnType<typeof buildScript>, label: string) => s.phases.find((p) => p.label === label)!;

test('una común: ignición, salto, caída, impacto, carta, espera y resumen, con los tiempos del guion', () => {
  const s = buildScript([pull('common')], { motion: 'full', surge: false });
  expect(labels(s)).toEqual(['ignicion', 'salto', 'caida', 'impacto', 'carta', 'espera-carta', 'resumen']);
  expect(phase(s, 'salto').dur).toBe(GUION.single.salto[0]);
  expect(phase(s, 'carta').dur).toBe(GUION.single.carta[0]);
  expect(phase(s, 'espera-carta').hold).toBe(true);
  // One after another, no gaps.
  s.phases.forEach((p, i) => {
    if (i > 0) expect(p.at).toBeCloseTo(s.phases[i - 1]!.at + s.phases[i - 1]!.dur, 6);
  });
  expect(s.trail).toEqual({ shown: 'ice', max: 'ice' });
  expect(ids(s).filter((x) => x === 'latido')).toHaveLength(2);
  expect(ids(s)).toEqual(expect.arrayContaining(['salto', 'meteoro', 'impacto', 'giro', 'revelar', 'sello', 'resumen']));
  expect(ids(s)).not.toContain('fanfarria');
  expect(ids(s)).not.toContain('impacto-grande');
  // Until the card waits: about 5 s.
  expect(phase(s, 'espera-carta').at).toBeGreaterThan(4);
  expect(phase(s, 'espera-carta').at).toBeLessThan(6);
});

test('una legendaria con fenómeno, destacada y holo: ascenso, fenómeno, fanfarria y la música a tope', () => {
  const g = pull('legendary', { featured: true, finish: 'holo', traits: { phenomenon: 'pulsar' } });
  const s = buildScript([g], { motion: 'full', surge: true });
  expect(labels(s)).toEqual(['ignicion', 'salto', 'ascenso', 'caida', 'impacto', 'carta', 'fenomeno', 'espera-carta', 'resumen']);
  expect(s.trail).toEqual({ shown: 'epic', max: 'legendary' });
  expect(ids(s)).toEqual(expect.arrayContaining(['ascenso', 'impacto-grande', 'fanfarria', 'destacada', 'acabado', 'fenomeno']));
  const reveal = s.cues.find((c) => c.id === 'revelar')!;
  expect(reveal.tier).toBe('legendary');
  expect(reveal.essential).toBe(true);
  expect(s.score.at(-1)).toEqual({ at: reveal.at, level: 3 });
  // Until the card waits: about 9 s, plus the phenomenon.
  expect(phase(s, 'espera-carta').at).toBeGreaterThan(8.5);
  expect(phase(s, 'espera-carta').at).toBeLessThan(11.5);
});

// The «Mítica» (plan «rareza Mítica» M1): everything a legendary has (big impact, fanfare, a coloured flash on its
// face, the shake, the surge, the top music layer), in its own colour, and never shorter.
test('una mítica: impacto grande, fanfarria, destello iridiscente en su cara, temblor y la música a tope', () => {
  const s = buildScript([pull('mythic', { finish: 'prismatic', traits: { phenomenon: 'supernova' } })], { motion: 'full', surge: true });
  expect(labels(s)).toEqual(['ignicion', 'salto', 'ascenso', 'caida', 'impacto', 'carta', 'fenomeno', 'espera-carta', 'resumen']);
  // The trail lies as a legendary, then breaks into the mythic.
  expect(s.trail).toEqual({ shown: 'legendary', max: 'mythic' });
  expect(ids(s)).toEqual(expect.arrayContaining(['ascenso', 'impacto-grande', 'fanfarria', 'acabado', 'fenomeno']));
  const reveal = s.cues.find((c) => c.id === 'revelar')!;
  expect(s.flashes.some((f) => f.color === 'mythic' && Math.abs(f.at - reveal.at) < 1e-9)).toBe(true);
  expect(s.shakes.some((k) => k.at > reveal.at)).toBe(true);
  expect(s.score.at(-1)).toEqual({ at: reveal.at, level: 3 });
  const legendary = buildScript([pull('legendary', { traits: { phenomenon: 'supernova' } })], { motion: 'full', surge: true });
  expect(phase(s, 'espera-carta').at).toBeGreaterThanOrEqual(phase(legendary, 'espera-carta').at);
  // The surge can happen on a mythic, at least as often as on a legendary.
  expect(GUION.surge.mythic).toBeGreaterThanOrEqual(GUION.surge.legendary);
});

test('cada duración por rareza tiene la de la mítica, nunca menor que la de la legendaria', () => {
  const rows = [GUION.single.ignicion, GUION.single.salto, GUION.single.ascenso, GUION.single.caida, GUION.single.impacto, GUION.single.paron, GUION.single.carta, GUION.ten.ignicion, GUION.ten.salto, GUION.ten.ascenso, GUION.ten.gap, GUION.ten.solo.quieto, GUION.fusion.orbita, GUION.fusion.ascenso, GUION.fusion.colapso, GUION.flash.impact, GUION.shake.impact];
  for (const row of rows) {
    expect(row).toHaveLength(TIERS.length);
    expect(row[5]!).toBeGreaterThanOrEqual(row[4]!);
  }
});

test('diez con una mítica: la última en primer plano, con su fanfarria', () => {
  const pulls = [pull('mythic'), pull('common'), pull('legendary'), pull('rare'), pull('common'), pull('uncommon'), pull('common'), pull('rare'), pull('common'), pull('uncommon')];
  const s = buildScript(pulls, { motion: 'full', surge: false });
  expect(s.order.map((i) => pulls[i]!.tier).slice(-2)).toEqual(['legendary', 'mythic']);
  expect(phase(s, 'solo-9').tier).toBe('mythic');
  const face = s.faces.find((f) => f.slot === 9)!;
  expect(s.cues.filter((c) => c.id === 'fanfarria').map((c) => c.at)).toContain(face.at + 0.1);
  expect(s.flashes.some((f) => f.color === 'mythic')).toBe(true);
  expect(maxFlashesPerSecond(s.flashes)).toBeLessThanOrEqual(2);
});

test('sin ascenso, la estela muestra desde el principio la rareza máxima; común y poco común no la anticipan', () => {
  expect(buildScript([pull('epic')], { motion: 'full', surge: false }).trail).toEqual({ shown: 'epic', max: 'epic' });
  expect(buildScript([pull('rare')], { motion: 'full' }).trail).toEqual({ shown: 'rare', max: 'rare' });
  expect(buildScript([pull('uncommon')], { motion: 'full' }).trail).toEqual({ shown: 'ice', max: 'ice' });
  const surge = buildScript([pull('epic')], { motion: 'full', surge: true });
  expect(surge.trail).toEqual({ shown: 'rare', max: 'epic' });
  expect(labels(surge)).toContain('ascenso');
});

test('el ascenso se decide con los ids: la misma tirada siempre igual', () => {
  const a = [pull('legendary'), pull('common')];
  expect(surgeRoll(a)).toBe(surgeRoll([...a]));
  expect(surgeRoll(a)).toBeGreaterThanOrEqual(0);
  expect(surgeRoll(a)).toBeLessThan(1);
  const s = buildScript(a, { motion: 'full' });
  expect(s.surge).toBe(surgeRoll(a) < GUION.surge.legendary);
});

test('diez: se revelan de menor a mayor rareza; épicas y legendarias en primer plano', () => {
  const pulls = [pull('epic'), pull('common'), pull('legendary'), pull('rare'), pull('common'), pull('uncommon'), pull('common'), pull('rare'), pull('common'), pull('uncommon')];
  const s = buildScript(pulls, { motion: 'full', surge: false });
  expect(s.order.map((i) => pulls[i]!.tier)).toEqual(['common', 'common', 'common', 'common', 'uncommon', 'uncommon', 'rare', 'rare', 'epic', 'legendary']);
  // Ties keep the server's order.
  expect(s.order.slice(0, 4)).toEqual([1, 4, 6, 8]);
  expect(labels(s)).toEqual([
    'ignicion',
    'salto',
    'caida',
    'impacto',
    'reparto',
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => `giro-${k}`),
    'solo-8',
    'solo-9',
    'final',
    'resumen',
  ]);
  expect(phase(s, 'solo-9').tier).toBe('legendary');
  expect(phase(s, 'solo-9').index).toBe(2);
  // About 17 s with one epic and one legendary.
  expect(s.duration).toBeGreaterThan(14);
  expect(s.duration).toBeLessThan(20);
  expect(s.cues.filter((c) => c.id === 'revelar')).toHaveLength(10);
  expect(s.score.map((x) => x.level)).toEqual([0, 1, 2, 3]);
});

test('diez comunes: unos 8,5 s', () => {
  const s = buildScript(Array.from({ length: 10 }, () => pull('common')), { motion: 'full' });
  expect(s.duration).toBeGreaterThan(7);
  expect(s.duration).toBeLessThan(10);
  expect(labels(s).some((l) => l.startsWith('solo-'))).toBe(false);
});

test('movimiento reducido: sin salto, ascenso, caída, impacto, destellos ni temblores, y corto', () => {
  const one = buildScript([pull('legendary', { traits: { phenomenon: 'comet' } })], { motion: 'reduced', surge: true });
  expect(labels(one)).toEqual(['ignicion', 'carta', 'fenomeno', 'espera-carta', 'resumen']);
  expect(one.flashes).toEqual([]);
  expect(one.shakes).toEqual([]);
  expect(one.surge).toBe(false);
  expect(phase(one, 'espera-carta').at).toBeLessThan(3);
  const ten = buildScript(Array.from({ length: 10 }, (_, i) => pull(TIERS[i % 5]!)), { motion: 'reduced' });
  expect(labels(ten).some((l) => l.startsWith('solo-') || l === 'salto')).toBe(false);
  expect(ten.duration).toBeLessThan(6.5);
});

test('fotosensibilidad: nunca más de 2 destellos en un segundo, opacidad hasta 0,6, ninguno rojo', () => {
  for (const tier of TIERS) {
    for (const surge of [false, true]) {
      for (const count of [1, 10]) {
        const pulls = count === 1 ? [pull(tier)] : Array.from({ length: 10 }, (_, i) => pull(i === 9 ? tier : TIERS[Math.min(i % 5, TIERS.indexOf(tier))]!));
        const s = buildScript(pulls, { motion: 'full', surge });
        expect(maxFlashesPerSecond(s.flashes)).toBeLessThanOrEqual(2);
        for (const f of s.flashes) {
          expect(f.alpha).toBeLessThanOrEqual(0.6);
          expect(f.color).not.toBe('red');
        }
      }
    }
  }
});

test('el Ensayo puede cambiar la duración de cada fase', () => {
  const s = buildScript([pull('rare')], { motion: 'full', overrides: { salto: 3, carta: 0.5 } });
  expect(phase(s, 'salto').dur).toBe(3);
  expect(phase(s, 'carta').dur).toBe(0.5);
  const ten = buildScript(Array.from({ length: 10 }, () => pull('common')), { motion: 'full', overrides: { giro: 1 } });
  expect(phase(ten, 'giro-3').dur).toBe(1);
});

test('Seguir: una tirada va a la carta, a su espera y al resumen; nunca se salta la carta', () => {
  const s = buildScript([pull('epic')], { motion: 'full', surge: false });
  const carta = phase(s, 'carta').at;
  const hold = phase(s, 'espera-carta').at;
  const resumen = phase(s, 'resumen').at;
  expect(nextStop(s, 0.5)).toBe(carta);
  expect(nextStop(s, carta + 0.1)).toBe(hold);
  expect(nextStop(s, hold)).toBe(resumen);
  expect(phaseAt(s, carta + 0.1).label).toBe('carta');
  expect(phaseAt(s, 0).label).toBe('ignicion');
  expect(phaseAt(s, s.duration + 5).label).toBe('resumen');
});

test('Seguir: diez van al reparto, a cada primer plano, a su vuelta y al final', () => {
  const pulls = [pull('common'), pull('epic'), pull('common'), pull('legendary'), pull('common'), pull('common'), pull('common'), pull('common'), pull('common'), pull('common')];
  const s = buildScript(pulls, { motion: 'full', surge: false });
  const reparto = phase(s, 'reparto').at;
  const solo8 = phase(s, 'solo-8');
  const solo9 = phase(s, 'solo-9');
  expect(nextStop(s, 1)).toBe(reparto);
  expect(nextStop(s, reparto + 0.2)).toBe(solo8.at);
  // In a close-up: to its way back.
  expect(nextStop(s, solo8.at + 0.3)).toBeCloseTo(solo8.at + solo8.dur - GUION.ten.solo.volver, 6);
  expect(nextStop(s, solo8.at + solo8.dur - 0.1)).toBe(solo9.at);
  expect(nextStop(s, phase(s, 'final').at + 0.1)).toBe(phase(s, 'resumen').at);
});

// A fusion (plan «fusión pro»): the galaxies going in circle a core, spiral into it and burst into the new one, whose
// card then turns as a single scan's does.
const five = (t: Tier): Tier[] => [t, t, t, t, t];

test('una fusión: ignición con las que entran, órbita, colapso, impacto, carta, espera y resumen', () => {
  const s = buildScript([pull('uncommon')], { motion: 'full', surge: false, intro: 'fusion', inputs: five('common') });
  expect(s.intro).toBe('fusion');
  expect(s.inputs).toEqual(five('common'));
  expect(labels(s)).toEqual(['ignicion', 'orbita', 'colapso', 'impacto', 'carta', 'espera-carta', 'resumen']);
  expect(phase(s, 'ignicion').dur).toBe(GUION.fusion.ignicion);
  expect(phase(s, 'orbita').dur).toBe(GUION.fusion.orbita[1]);
  expect(phase(s, 'colapso').dur).toBe(GUION.fusion.colapso[1]);
  s.phases.forEach((p, i) => {
    if (i > 0) expect(p.at).toBeCloseTo(s.phases[i - 1]!.at + s.phases[i - 1]!.dur, 6);
  });
  // The riser spans the orbit, the plunge sounds at the collapse, the burst always.
  const riser = s.cues.find((c) => c.id === 'salto')!;
  expect(riser.at).toBeCloseTo(phase(s, 'orbita').at, 6);
  expect(riser.dur).toBeCloseTo(phase(s, 'orbita').dur, 6);
  expect(s.cues.find((c) => c.id === 'meteoro')!.at).toBeCloseTo(phase(s, 'colapso').at, 6);
  expect(s.cues.find((c) => c.id === 'impacto')!.essential).toBe(true);
  expect(ids(s).filter((x) => x === 'latido')).toHaveLength(2);
  expect(s.trail).toEqual({ shown: 'ice', max: 'ice' });
  // Until the card waits: about 4,5 s.
  expect(phase(s, 'espera-carta').at).toBeGreaterThan(3.8);
  expect(phase(s, 'espera-carta').at).toBeLessThan(5.5);
});

test('una fusión que da legendaria: el núcleo la anticipa, a veces asciende, y suena la fanfarria', () => {
  const s = buildScript([pull('legendary')], { motion: 'full', surge: true, intro: 'fusion', inputs: five('epic') });
  expect(labels(s)).toEqual(['ignicion', 'orbita', 'ascenso', 'colapso', 'impacto', 'carta', 'espera-carta', 'resumen']);
  expect(s.trail).toEqual({ shown: 'epic', max: 'legendary' });
  const riser = s.cues.find((c) => c.id === 'salto')!;
  expect(riser.dur).toBeCloseTo(phase(s, 'orbita').dur + phase(s, 'ascenso').dur, 6);
  expect(ids(s)).toEqual(expect.arrayContaining(['ascenso', 'impacto-grande', 'fanfarria']));
  expect(s.score.at(-1)!.level).toBe(3);
  expect(phase(s, 'espera-carta').at).toBeGreaterThan(7);
  expect(phase(s, 'espera-carta').at).toBeLessThan(9);
  // Without the surge it goes straight to its colour.
  const plain = buildScript([pull('legendary')], { motion: 'full', surge: false, intro: 'fusion', inputs: five('epic') });
  expect(labels(plain)).not.toContain('ascenso');
  expect(plain.trail).toEqual({ shown: 'legendary', max: 'legendary' });
});

test('una fusión con movimiento reducido: el anillo, el fundido en el núcleo y la carta, sin destellos ni temblores', () => {
  const s = buildScript([pull('rare')], { motion: 'reduced', intro: 'fusion', inputs: five('uncommon') });
  expect(labels(s)).toEqual(['ignicion', 'colapso', 'carta', 'espera-carta', 'resumen']);
  expect(phase(s, 'colapso').dur).toBe(GUION.calm.colapso);
  expect(s.flashes).toEqual([]);
  expect(s.shakes).toEqual([]);
  expect(s.duration).toBeLessThan(3);
});

test('una fusión: fotosensibilidad, el Ensayo cambia la órbita y el colapso, y Seguir va a la carta', () => {
  for (const t of TIERS) {
    for (const surge of [false, true]) {
      const s = buildScript([pull(t)], { motion: 'full', surge, intro: 'fusion', inputs: five(t) });
      expect(maxFlashesPerSecond(s.flashes)).toBeLessThanOrEqual(2);
      for (const f of s.flashes) expect(f.alpha).toBeLessThanOrEqual(0.6);
    }
  }
  const s = buildScript([pull('epic')], { motion: 'full', surge: false, intro: 'fusion', inputs: five('rare'), overrides: { orbita: 3, colapso: 1.5 } });
  expect(phase(s, 'orbita').dur).toBe(3);
  expect(phase(s, 'colapso').dur).toBe(1.5);
  expect(nextStop(s, 0)).toBeCloseTo(phase(s, 'carta').at, 6);
  expect(nextStop(s, phase(s, 'carta').at + 0.1)).toBeCloseTo(phase(s, 'espera-carta').at, 6);
  expect(nextStop(s, phase(s, 'espera-carta').at)).toBeCloseTo(phase(s, 'resumen').at, 6);
});

test('un escaneo sigue siendo un escaneo: sin anillo ni galaxias que entran', () => {
  const s = buildScript([pull('rare')], { motion: 'full', surge: false });
  expect(s.intro).toBe('scan');
  expect(s.inputs).toEqual([]);
});
