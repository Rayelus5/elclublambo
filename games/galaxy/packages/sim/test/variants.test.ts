import { describe, expect, test } from 'vitest';
import { applyOffer, baseOf, contentSchema, createSim, DEFAULT_CONTENT, offerFor } from '../src/index';
import { options, quietSim } from './fixtures';
import { crowd, proving } from './proving';

// Starting-weapon variants and level bonuses (GDD §6, M4b-1): each probe's weapon has two variants that open at levels 4
// and 8, sidegrades of their base; the probe starts the run with the one chosen, and its level's bonuses are one more
// source of stats, so they go through the diminishing returns and caps of §8.6.

const C = DEFAULT_CONTENT;
const byId = (id: string) => C.weapons.find((w) => w.id === id)!;

describe('el catálogo', () => {
  test('cada arma inicial tiene dos variantes, en los niveles 4 y 8', () => {
    for (const probe of C.probes) {
      const variants = C.weapons.filter((w) => w.variant?.of === probe.weapon);
      expect(variants.map((v) => v.variant!.unlockAt).sort(), probe.id).toEqual([4, 8]);
    }
    expect(C.weapons.filter((w) => w.variant)).toHaveLength(16);
  });

  test('una variante rinde parecido a su base, medido en la simulación (anillos y multitud)', () => {
    // Measured, not nominal (M4b-1 final review): what a field does with its cooldown (turrets) or with a wider area
    // (more enemies caught) only shows when the weapon plays. Each at its last level on both proving grounds.
    const top = (id: string) => ({ weapons: [{ id, level: byId(id).levels.length }], passives: [], relics: [] });
    for (const v of C.weapons.filter((w) => w.variant)) {
      const base = v.variant!.of;
      const rings = proving(C, top(v.id), 20) / proving(C, top(base), 20);
      const many = crowd(C, top(v.id), 20) / crowd(C, top(base), 20);
      for (const [ground, ratio] of [['anillos', rings], ['multitud', many]] as const) {
        expect(ratio, `${v.id} ${ground}`).toBeGreaterThanOrEqual(0.75);
        expect(ratio, `${v.id} ${ground}`).toBeLessThanOrEqual(1.25);
      }
    }
  }, 120_000);

  test('una variante no cambia lo que su tipo de arma no usa (los discos no perforan)', () => {
    const breach = byId('boomerang-breach');
    breach.levels.forEach((l, i) => expect(l.pierce, `nivel ${i + 1}`).toBe(byId('boomerang').levels[i]!.pierce));
  });

  test('baseOf lleva de la variante a su base y deja igual lo demás', () => {
    expect(baseOf(C, 'pulse-twin')).toBe('pulse');
    expect(baseOf(C, 'pulse')).toBe('pulse');
    expect(baseOf(C, 'pulse-storm')).toBe('pulse-storm');
  });

  test('el esquema rechaza una variante de una evolución y dos variantes al mismo nivel', () => {
    const ofEvolution = structuredClone(C);
    ofEvolution.weapons.find((w) => w.id === 'pulse-twin')!.variant = { of: 'pulse-storm', unlockAt: 4 };
    expect(contentSchema.safeParse(ofEvolution).success).toBe(false);
    const twice = structuredClone(C);
    twice.weapons.find((w) => w.id === 'pulse-frost')!.variant = { of: 'pulse', unlockAt: 4 };
    expect(contentSchema.safeParse(twice).success).toBe(false);
  });
});

describe('la salida', () => {
  test('la sonda sale con la variante elegida', () => {
    const sim = createSim(options(C, { probes: [{ probe: 'lumen', relics: [], variant: 'pulse-twin' }] }));
    expect(sim.probes[0]!.weapons.map((w) => w.id)).toEqual(['pulse-twin']);
  });

  test('sin variante sale con su arma base', () => {
    const sim = createSim(options(C, { probes: [{ probe: 'lumen', relics: [], variant: null }] }));
    expect(sim.probes[0]!.weapons.map((w) => w.id)).toEqual(['pulse']);
  });

  test('una variante que no es de su arma no vale', () => {
    expect(() => createSim(options(C, { probes: [{ probe: 'lumen', relics: [], variant: 'nova-wide' }] }))).toThrow(/^bad_variant/);
    expect(() => createSim(options(C, { probes: [{ probe: 'lumen', relics: [], variant: 'pulse' }] }))).toThrow(/^bad_variant/);
  });

  test('los bonos suben las estadísticas con rendimiento decreciente', () => {
    const plain = createSim(options(C, { probes: [{ probe: 'lumen', relics: [] }] })).probes[0]!;
    const veteran = createSim(
      options(C, { probes: [{ probe: 'lumen', relics: [], bonuses: [{ stat: 'maxHp', value: 0.27 }, { stat: 'damage', value: 0.18 }] }] }),
    ).probes[0]!;
    expect(veteran.stats.maxHp).toBeGreaterThan(plain.stats.maxHp);
    expect(veteran.stats.maxHp).toBeLessThanOrEqual(plain.def.hp * 1.27 + 1e-9);
    expect(veteran.hp).toBe(veteran.stats.maxHp);
    expect(veteran.stats.damage).toBeGreaterThan(plain.stats.damage);
    expect(veteran.stats.damage).toBeLessThanOrEqual(1.18 + 1e-9);
  });

  test('la misma semilla con los mismos bonos y variante da la misma partida', () => {
    const opts = options(C, { probes: [{ probe: 'lumen', relics: [], variant: 'pulse-frost', bonuses: [{ stat: 'damage', value: 0.1 }] }] });
    const a = createSim(opts);
    const b = createSim(structuredClone(opts));
    expect(JSON.stringify(a.probes[0]!.stats)).toBe(JSON.stringify(b.probes[0]!.stats));
    expect(a.probes[0]!.weapons).toEqual(b.probes[0]!.weapons);
  });
});

describe('las ofertas', () => {
  test('nunca se ofrece la base si llevas su variante, y la variante sí sube', () => {
    const sim = quietSim();
    const p = sim.probes[0]!;
    p.weapons = [{ id: 'pulse-twin', level: 1, t: 0 }];
    let upgrades = 0;
    for (let i = 0; i < 200; i++) {
      const offers = offerFor(sim, p);
      for (const o of offers) {
        const banned = o.kind === 'weapon' && (o.id === 'pulse' || (o.level === 1 && C.weapons.some((w) => w.id === o.id && w.variant)));
        expect(banned, JSON.stringify(o)).toBe(false);
        if (o.kind === 'weapon' && o.id === 'pulse-twin') upgrades++;
      }
      // Keep the arsenal small so the variant stays on offer.
      if (offers[0] && !(offers[0].kind === 'weapon' && offers[0].level === 1)) applyOffer(sim, p, offers[0]);
    }
    expect(upgrades).toBeGreaterThan(0);
  });

  test('ninguna variante se ofrece como arma nueva', () => {
    const sim = quietSim();
    const p = sim.probes[0]!;
    for (let i = 0; i < 100; i++) {
      for (const o of offerFor(sim, p)) {
        if (o.kind === 'weapon') expect(C.weapons.find((w) => w.id === o.id)?.variant, o.id).toBeUndefined();
      }
    }
  });

  test('la variante al máximo evoluciona en la evolución de su base y deja su hueco', () => {
    const sim = quietSim(undefined, { probes: [{ probe: 'lumen', relics: [] }] });
    const p = sim.probes[0]!;
    p.weapons = [{ id: 'nova', level: 1, t: 0 }, { id: 'pulse-twin', level: byId('pulse-twin').levels.length, t: 0 }];
    p.passives.push({ id: 'capacitor', level: 1 });
    expect(offerFor(sim, p)[0]).toEqual({ kind: 'evolve', id: 'pulse-storm', level: 1 });
    applyOffer(sim, p, { kind: 'evolve', id: 'pulse-storm', level: 1 });
    expect(p.weapons.map((w) => w.id)).toEqual(['nova', 'pulse-storm']);
  });
});
