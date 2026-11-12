import type { GalaxySummary, Tier } from '@galaxy/shared';
import { DEFAULT_CONTENT, type Content } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { copy } from '../src/copy/es';
import { relicSheet } from '../src/hangar/relic-sheet';

// What a galaxy does as a relic (plan «escáner pro», part D; the owner: «que el usuario antes de equiparse reliquias
// pueda ver lo que hace cada una»): every power with its number from the live content, the sets it would make, the
// stacking it would suffer and what it would replace — with the loadout it would join, or on its own.

let n = 0;
function galaxy(traits: Record<string, string>, tier: Tier = 'rare', level = 1): GalaxySummary {
  n++;
  return {
    id: `g${n}`,
    seed: String(1000 + n),
    tier,
    finish: 'normal',
    traits: { galaxy_type: 'spiral', arms: '4', size: 'medium', inclination: 'face_on', core: 'bright', star_density: 'normal', palette: 'nebula', background: 'deep_void', phenomenon: 'none', ...traits },
    name: `Galaxia ${n}`,
    designation: `GX-${n}`,
    level,
  } as unknown as GalaxySummary;
}
const kinds = (m: ReturnType<typeof relicSheet>) => m.powers.map((p) => p.kind);

test('una espiral sola: su pasiva con la potencia, los proyectiles por sus brazos, su elemento y su fondo', () => {
  const g = galaxy({ galaxy_type: 'spiral', arms: '5', palette: 'solar_gold', background: 'deep_void' });
  const m = relicSheet(g, DEFAULT_CONTENT);
  expect(m.alone).toBe(true);
  expect(m.skill.family).toBe('blades');
  expect(kinds(m)).toEqual(expect.arrayContaining(['family', 'count', 'power', 'background']));
  expect(m.powers.find((p) => p.kind === 'family')!.name).toBe(copy.hangar.families.blades);
  expect(m.powers.find((p) => p.kind === 'count')!.text).toBe(copy.hangar.sheet.count(5));
  expect(m.powers.find((p) => p.kind === 'power')!.name).toBe(copy.hangar.power(m.skill.magnitude));
  expect(m.replaces).toBeNull();
});

test('el fenómeno y el núcleo cuásar se explican con los números de la configuración', () => {
  const g = galaxy({ phenomenon: 'pulsar', core: 'quasar' }, 'legendary');
  const m = relicSheet(g, DEFAULT_CONTENT);
  expect(m.powers.find((p) => p.kind === 'phenomenon')!.name).toBe(copy.hangar.phenomena.pulsar);
  const q = DEFAULT_CONTENT.relics.quasar;
  expect(m.powers.find((p) => p.kind === 'quasar')!.text).toBe(copy.hangar.sheet.quasar(q.cooldown, q.pierce));
  // A retuned quasar reads with the new numbers (the live content, not the built-in one).
  const live: Content = { ...DEFAULT_CONTENT, relics: { ...DEFAULT_CONTENT.relics, quasar: { ...q, cooldown: 7 } } };
  expect(relicSheet(g, live).powers.find((p) => p.kind === 'quasar')!.text).toBe(copy.hangar.sheet.quasar(7, q.pierce));
});

test('para equipar: calcula con el equipo en el que entraría y dice a cuál sustituye', () => {
  const a = galaxy({ galaxy_type: 'ring' });
  const b = galaxy({ galaxy_type: 'elliptical' });
  const candidate = galaxy({ galaxy_type: 'ring' });
  const m = relicSheet(candidate, DEFAULT_CONTENT, { loadout: [a, b, null], slot: 1 });
  expect(m.alone).toBe(false);
  expect(m.replaces?.id).toBe(b.id);
  expect(relicSheet(candidate, DEFAULT_CONTENT, { loadout: [a, b, null], slot: 2 }).replaces).toBeNull();
});

test('avisa del apilado cuando ya hay bastantes de su familia', () => {
  const from = DEFAULT_CONTENT.relics.stacking.from;
  const same = Array.from({ length: from - 1 }, () => galaxy({ galaxy_type: 'ring' }));
  const candidate = galaxy({ galaxy_type: 'ring' });
  const m = relicSheet(candidate, DEFAULT_CONTENT, { loadout: [...same, null], slot: same.length });
  expect(m.stacking).not.toBeNull();
  expect(m.stacking!.count).toBe(from - 1);
  expect(m.stacking!.factor).toBeLessThan(1);
  expect(relicSheet(candidate, DEFAULT_CONTENT).stacking).toBeNull();
});

test('el eco dice qué pasiva copiaría en ese equipo', () => {
  const ring = galaxy({ galaxy_type: 'ring' });
  const merger = galaxy({ galaxy_type: 'merger' });
  const m = relicSheet(merger, DEFAULT_CONTENT, { loadout: [ring, null], slot: 1 });
  expect(m.skill.family).toBe('echo');
  expect(m.powers.find((p) => p.kind === 'family')!.detail).toBe(copy.hangar.skillInfo.echoCopies(copy.hangar.families.aura));
});
