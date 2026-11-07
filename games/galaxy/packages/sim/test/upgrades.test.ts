import { expect, test } from 'vitest';
import { applyOffer, offerFor } from '../src/index';
import { quietSim } from './fixtures';

// Level-up offers (GDD §5.1): 1 of 3 between new weapons, weapon levels, new passives and passive levels, never past
// 6 weapons, 6 passives or a max level; with nothing left, a repair.

test('ofrece 3 opciones distintas y la misma semilla da las mismas', () => {
  const a = quietSim();
  const b = quietSim();
  const oa = offerFor(a, a.probes[0]!);
  expect(oa).toHaveLength(3);
  expect(new Set(oa.map((o) => `${o.kind}:${o.id}`)).size).toBe(3);
  expect(offerFor(b, b.probes[0]!)).toEqual(oa);
});

test('con 6 armas no ofrece armas nuevas', () => {
  const sim = quietSim();
  const p = sim.probes[0]!;
  p.weapons = ['pulse', 'nova', 'lance', 'orbit', 'trail', 'arc'].map((id) => ({ id, level: 1, t: 0 }));
  for (let i = 0; i < 40; i++) {
    for (const o of offerFor(sim, p)) {
      if (o.kind === 'weapon') expect(p.weapons.map((w) => w.id)).toContain(o.id);
    }
  }
});

test('no ofrece niveles por encima del máximo y, sin nada que ofrecer, da Reparación', () => {
  const sim = quietSim();
  const p = sim.probes[0]!;
  const max = (id: string) => sim.content.weapons.find((w) => w.id === id)!.levels.length;
  p.weapons = ['pulse', 'nova', 'lance', 'orbit', 'trail', 'arc'].map((id) => ({ id, level: max(id), t: 0 }));
  p.passives = ['armor', 'thrusters', 'capacitor', 'amplifier', 'lens', 'magnet'].map((id) => ({
    id,
    level: sim.content.passives.find((x) => x.id === id)!.levels.length,
  }));
  expect(offerFor(sim, p)).toEqual([{ kind: 'heal', id: 'heal', level: 0 }]);

  p.weapons[0]!.level = max('pulse') - 1;
  const only = offerFor(sim, p);
  expect(only).toEqual([{ kind: 'weapon', id: 'pulse', level: max('pulse') }]);
});

test('Reparación devuelve el 30 % de la vida sin pasarse del máximo', () => {
  const sim = quietSim();
  const p = sim.probes[0]!;
  p.hp = 50;
  applyOffer(sim, p, { kind: 'heal', id: 'heal', level: 0 });
  expect(p.hp).toBe(80);
  applyOffer(sim, p, { kind: 'heal', id: 'heal', level: 0 });
  expect(p.hp).toBe(100);
});

test('elegir un arma nueva la añade a nivel 1 y subirla aumenta su nivel', () => {
  const sim = quietSim();
  const p = sim.probes[0]!;
  applyOffer(sim, p, { kind: 'weapon', id: 'nova', level: 1 });
  expect(p.weapons).toContainEqual(expect.objectContaining({ id: 'nova', level: 1 }));
  applyOffer(sim, p, { kind: 'weapon', id: 'nova', level: 2 });
  expect(p.weapons.filter((w) => w.id === 'nova')).toEqual([expect.objectContaining({ id: 'nova', level: 2 })]);
});
