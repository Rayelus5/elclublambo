import { expect, test } from 'vitest';
import { type Content, contentWarnings, DEFAULT_CONTENT } from '../src/index';

// What the content allows but probably does not want (the content editor, 2026-11-16, P7): warnings, never refusals.
// The panel shows them before publishing and asks to read them; the default content has none.

const clone = (): Content => structuredClone(DEFAULT_CONTENT);
const codes = (c: Content) => contentWarnings(c).map((w) => `${w.code}@${w.path}`);

test('el contenido por defecto no tiene avisos', () => {
  expect(contentWarnings(DEFAULT_CONTENT)).toEqual([]);
});

test('un sector más fácil que el anterior, o uno de temporada que no es el más duro', () => {
  const c = clone();
  c.sectors[1]!.enemyHp = c.sectors[0]!.enemyHp;
  expect(codes(c)).toContain('sector_hp_order@sectors.1.enemyHp');
  const d = clone();
  const season = d.sectors.findIndex((s) => s.season);
  d.sectors[season]!.enemyHp = d.sectors[0]!.enemyHp;
  expect(codes(d)).toContain(`season_not_hardest@sectors.${season}.enemyHp`);
  const e = clone();
  e.sectors[2]!.coreDamage = e.sectors[1]!.coreDamage;
  expect(codes(e)).toContain('sector_core_order@sectors.2.coreDamage');
});

test('un sector con pocas familias de enemigos', () => {
  const c = clone();
  c.sectors[0]!.spawns = c.sectors[0]!.spawns.slice(0, 2);
  expect(codes(c)).toContain('sector_families@sectors.0.spawns');
});

test('un arma base sin evolución', () => {
  const c = clone();
  const evo = c.weapons.findIndex((w) => w.evolution);
  const base = c.weapons.findIndex((w) => w.id === c.weapons[evo]!.evolution!.from);
  c.weapons.splice(evo, 1);
  expect(codes(c)).toContain(`weapon_no_evolution@weapons.${base > evo ? base - 1 : base}`);
});

test('un enemigo o un Núcleo que no sale en ningún sitio', () => {
  const c = clone();
  c.enemies.push({ ...structuredClone(c.enemies[0]!), id: 'olvidado' });
  c.bosses.push({ ...structuredClone(c.bosses[0]!), id: 'olvidado-core' });
  expect(codes(c)).toEqual(expect.arrayContaining([`enemy_unused@enemies.${c.enemies.length - 1}`, `boss_unused@bosses.${c.bosses.length - 1}`]));
});

test('unos pesos de evento para un sector que no existe', () => {
  const c = clone();
  c.events.sectors['no-existe'] = { storm: 2 };
  expect(codes(c)).toContain('events_sector_unknown@events.sectors.no-existe');
});
