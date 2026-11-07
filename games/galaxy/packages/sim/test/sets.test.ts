import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { activeSets, DEFAULT_CONTENT, deriveStats, possibleSets, type RelicInput, relicSkill } from '../src/index';
import { quietSim } from './fixtures';

// Relic sets (GDD §8.3, «Conjunto»): the same trait on 2 or 3 equipped galaxies, or a galaxy type with a phenomenon,
// give a bonus on top of each relic's own passive.

const C = DEFAULT_CONTENT;
let n = 0;
/** A relic whose traits never match another's unless the test says so. */
const relic = (traits: Record<string, string>, tier = 0): RelicInput => {
  n++;
  return {
    id: `r${n}`,
    seed: String(n),
    tier,
    level: 1,
    traits: { galaxy_type: `t${n}`, palette: `p${n}`, background: `b${n}`, core: `c${n}`, size: 'medium', star_density: 'normal', phenomenon: 'none', ...traits },
  };
};
const ids = (sets: { id: string }[]) => sets.map((s) => s.id);

describe('activación', () => {
  test('dos de la misma paleta activan la Resonancia; tres la sustituyen por la de 3', () => {
    const a = relic({ palette: 'solar_gold' });
    const b = relic({ palette: 'solar_gold' });
    expect(activeSets([a, b], C)).toEqual([
      expect.objectContaining({ id: 'resonance', count: 2, bonus: { stats: [{ stat: 'elemental', value: 0.25 }] }, members: [a.id, b.id] }),
    ]);
    const c = relic({ palette: 'solar_gold' });
    expect(activeSets([a, b, c], C)).toEqual([expect.objectContaining({ id: 'resonance', count: 3, bonus: { stats: [{ stat: 'elemental', value: 0.5 }] } })]);
  });

  test('cada conjunto de mismo rasgo: tipo, fondo y núcleo', () => {
    expect(ids(activeSets([relic({ galaxy_type: 'ring' }), relic({ galaxy_type: 'ring' })], C))).toEqual(['lineage']);
    expect(ids(activeSets([relic({ background: 'cmb' }), relic({ background: 'cmb' })], C))).toEqual(['same-sky']);
    expect(ids(activeSets([relic({ core: 'quasar' }), relic({ core: 'quasar' })], C))).toEqual(['twin-cores']);
  });

  test('una combinación vale en la misma galaxia y entre dos', () => {
    expect(ids(activeSets([relic({ galaxy_type: 'spiral', phenomenon: 'satellite_galaxy' })], C))).toEqual(['satellite-arm']);
    expect(ids(activeSets([relic({ galaxy_type: 'barred_spiral' }), relic({ phenomenon: 'pulsar' })], C))).toEqual(['lighthouse']);
  });

  test('con una sola galaxia sin combinación, o rasgos que faltan, no hay conjuntos', () => {
    expect(activeSets([relic({})], C)).toEqual([]);
    const bare = (k: number): RelicInput => ({ id: `bare${k}`, seed: '1', tier: 0, level: 1, traits: {} });
    expect(activeSets([bare(1), bare(2)], C)).toEqual([]);
  });

  test('no depende del orden de las galaxias', () => {
    const pool = [
      relic({ palette: 'solar_gold', galaxy_type: 'spiral' }),
      relic({ palette: 'solar_gold', phenomenon: 'satellite_galaxy' }),
      relic({ galaxy_type: 'spiral', background: 'cmb' }),
      relic({ background: 'cmb', core: 'quasar' }),
      relic({ core: 'quasar', palette: 'solar_gold' }),
    ];
    fc.assert(
      fc.property(fc.shuffledSubarray(pool, { minLength: 2, maxLength: 5 }), fc.integer({ min: 0, max: 1000 }), (picked, seed) => {
        const shuffled = [...picked].sort((x, y) => ((x.id.charCodeAt(1) * 31 + seed) % 7) - ((y.id.charCodeAt(1) * 31 + seed) % 7));
        expect(activeSets(shuffled, C)).toEqual(activeSets(picked, C));
      }),
      { numRuns: 200 },
    );
  });
});

describe('bonos', () => {
  test('el bonus de estadística llega a las estadísticas de la sonda', () => {
    const sim = quietSim(undefined, { probes: [{ probe: 'lumen', relics: [relic({ palette: 'solar_gold' }), relic({ palette: 'solar_gold' })] }] });
    expect(deriveStats(sim, sim.probes[0]!).elemental).toBeCloseTo(1.25, 9);
  });

  test('el Linaje sube la magnitud solo de sus miembros', () => {
    const a = relic({ galaxy_type: 'ring' });
    const b = relic({ galaxy_type: 'ring' });
    const other = relic({ galaxy_type: 'irregular' });
    const all = [a, b, other];
    expect(relicSkill(a, all, C).magnitude).toBeCloseTo(relicSkill(a, [a], C).magnitude * 1.15, 9);
    expect(relicSkill(other, all, C).magnitude).toBeCloseTo(relicSkill(other, [other], C).magnitude, 9);
  });

  test('Mismo cielo multiplica el bonus de fondo de sus miembros', () => {
    const a = relic({ background: 'deep_void' });
    const b = relic({ background: 'deep_void' });
    expect(relicSkill(a, [a, b], C).background).toEqual({ stat: 'armor', value: 0.08 * 1.5 });
    expect(relicSkill(a, [a], C).background).toEqual({ stat: 'armor', value: 0.08 });
  });
});

describe('posibles', () => {
  test('dice qué falta: el fenómeno de una combinación o la tercera galaxia de un conjunto', () => {
    expect(possibleSets([relic({ galaxy_type: 'spiral' })], C)).toContainEqual({
      id: 'satellite-arm',
      name: 'Brazo satélite',
      needs: 1,
      missing: { trait: 'phenomenon', value: 'satellite_galaxy' },
    });
    expect(possibleSets([relic({ palette: 'solar_gold' }), relic({ palette: 'solar_gold' })], C)).toContainEqual({
      id: 'resonance',
      name: 'Resonancia cromática',
      needs: 1,
      missing: { trait: 'palette', value: 'solar_gold' },
    });
  });
});
