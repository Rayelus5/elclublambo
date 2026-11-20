import { describe, expect, test } from 'vitest';
import { applyOffer, evolutionsFor, offerFor, type RelicInput } from '../src/index';
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
  // Without evolutions: with them, a maxed arsenal still has something to offer.
  const sim = quietSim((c) => (c.weapons = c.weapons.filter((w) => !w.evolution)));
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

describe('evoluciones', () => {
  function ready(level = 5, relics: RelicInput[] = []) {
    const sim = quietSim(undefined, { probes: [{ probe: 'lumen', relics }] });
    const p = sim.probes[0]!;
    p.weapons = [{ id: 'pulse', level, t: 0 }];
    return { sim, p };
  }

  test('se ofrece primera cuando el arma está al máximo y se tiene su pasiva, aunque sea a nivel 1', () => {
    const { sim, p } = ready();
    expect(offerFor(sim, p).some((o) => o.kind === 'evolve')).toBe(false);
    p.passives.push({ id: 'capacitor', level: 1 });
    expect(evolutionsFor(sim, p).map((w) => w.id)).toEqual(['pulse-storm']);
    expect(offerFor(sim, p)[0]).toEqual({ kind: 'evolve', id: 'pulse-storm', level: 1 });
  });

  test('no se ofrece con el arma por debajo de su nivel máximo', () => {
    const { sim, p } = ready(4);
    p.passives.push({ id: 'capacitor', level: 5 });
    expect(evolutionsFor(sim, p)).toEqual([]);
  });

  test('el elemento de una reliquia equipada cuenta como requisito', () => {
    const solar: RelicInput = { id: 'r', seed: '1', tier: 0, level: 1, traits: { galaxy_type: 'dwarf', palette: 'solar_gold' } };
    const withRelic = ready(5, [solar]);
    withRelic.p.weapons = [{ id: 'trail', level: 5, t: 0 }];
    expect(evolutionsFor(withRelic.sim, withRelic.p).map((w) => w.id)).toEqual(['plasma-wake']);
    const without = ready();
    without.p.weapons = [{ id: 'trail', level: 5, t: 0 }];
    expect(evolutionsFor(without.sim, without.p)).toEqual([]);
  });

  test('elegirla sustituye el arma en su hueco, avisa y no se vuelve a ofrecer', () => {
    const { sim, p } = ready();
    p.weapons = [{ id: 'nova', level: 1, t: 0 }, { id: 'pulse', level: 5, t: 0 }];
    p.passives.push({ id: 'capacitor', level: 1 });
    sim.events.length = 0;
    applyOffer(sim, p, { kind: 'evolve', id: 'pulse-storm', level: 1 });
    expect(p.weapons).toEqual([
      { id: 'nova', level: 1, t: 0 },
      { id: 'pulse-storm', level: 1, t: 0 },
    ]);
    expect(sim.events).toContainEqual({ t: 'evolve', probe: 0, from: 'pulse', to: 'pulse-storm' });
    expect(evolutionsFor(sim, p)).toEqual([]);
  });

  test('las evoluciones nunca salen como arma nueva y el arma base no vuelve tras evolucionar', () => {
    const { sim, p } = ready();
    p.passives.push({ id: 'capacitor', level: 1 });
    applyOffer(sim, p, { kind: 'evolve', id: 'pulse-storm', level: 1 });
    const evolved = new Set(sim.content.weapons.filter((w) => w.evolution).map((w) => w.id));
    for (let i = 0; i < 200; i++) {
      for (const o of offerFor(sim, p)) {
        if (o.kind === 'weapon') {
          expect(evolved.has(o.id)).toBe(false);
          expect(o.id).not.toBe('pulse');
        }
      }
    }
  });

  test('el contenido trae 21 armas y una evolución para cada una (las variantes de M4b-1 aparte)', () => {
    const base = sim0().content.weapons.filter((w) => !w.evolution && !w.variant && w.id !== 'dud');
    const evos = sim0().content.weapons.filter((w) => w.evolution);
    expect(base).toHaveLength(21);
    expect(evos).toHaveLength(21);
    expect(new Set(evos.map((w) => w.evolution!.from))).toEqual(new Set(base.map((w) => w.id)));
  });

  test('las cinco armas de noviembre: un tipo nuevo cada una, cinco niveles, ninguna inicial, y su evolución con la pasiva y el especial acordados', () => {
    const C = sim0().content;
    const plan: [string, string, string, string][] = [
      ['harpoon', 'tow-harpoon', 'thrusters', 'pierceAll'],
      ['sling', 'singularity-catapult', 'repulsor', 'vortex'],
      ['decoy', 'mirage-legion', 'deflector', 'echo'],
      ['lighthouse', 'binary-lighthouse', 'inertia', 'chain'],
      ['mortar', 'siege-mortar', 'core-hunter', 'chain'],
    ];
    for (const [id, evoId, passive, special] of plan) {
      const base = C.weapons.find((w) => w.id === id)!;
      const evo = C.weapons.find((w) => w.id === evoId)!;
      expect(base.kind, id).toBe(id);
      expect(base.levels, id).toHaveLength(5);
      expect(C.weapons.filter((w) => w.kind === id).map((w) => w.id), id).toEqual([id, evoId]);
      expect(C.probes.map((p) => p.weapon), id).not.toContain(id);
      expect(evo.levels, evoId).toHaveLength(1);
      expect(evo.evolution, evoId).toEqual({ from: id, requires: { passive } });
      expect(evo.special, evoId).toBe(special);
      expect(evo.icon, evoId).toBe(`${base.icon}-evo`);
    }
    // The Faro binario turns two beams at least.
    expect(C.weapons.find((w) => w.id === 'binary-lighthouse')!.levels[0]!.count).toBeGreaterThanOrEqual(2);
    // Every evolution asks for its own passive or element: no two share one.
    const asks = C.weapons.filter((w) => w.evolution).map((w) => JSON.stringify(w.evolution!.requires));
    expect(new Set(asks).size).toBe(asks.length);
  });
});

const sim0 = () => quietSim();
