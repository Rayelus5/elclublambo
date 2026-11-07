import { describe, expect, test } from 'vitest';
import { contentSchema, DEFAULT_CONTENT, type Content } from '../src/index';

// Run content is data (GDD §13.1 bis): sectors, fauna, bosses, weapons, passives and tuning live in the live config,
// so the admin can remix a season without new code. The schema refuses anything that would break a run.

const clone = (): Content => structuredClone(DEFAULT_CONTENT);

describe('contenido por defecto', () => {
  test('pasa el esquema tal cual', () => {
    expect(contentSchema.parse(DEFAULT_CONTENT)).toEqual(DEFAULT_CONTENT);
  });

  test('un objeto vacío toma el contenido por defecto', () => {
    expect(contentSchema.parse({})).toEqual(DEFAULT_CONTENT);
  });

  test('trae el sector, la fauna, el jefe, las armas, las pasivas y la sonda de M3a', () => {
    expect(DEFAULT_CONTENT.sectors.map((s) => s.id)).toEqual(['outer-nebula']);
    expect(DEFAULT_CONTENT.enemies.map((e) => e.id).sort()).toEqual(['cell', 'cellet', 'mite', 'ray', 'shell', 'spitter']);
    expect(DEFAULT_CONTENT.bosses.map((b) => b.id)).toEqual(['hive']);
    expect(DEFAULT_CONTENT.weapons.map((w) => w.id)).toEqual(['pulse', 'nova', 'lance', 'orbit', 'trail', 'arc', 'drone']);
    expect(DEFAULT_CONTENT.passives).toHaveLength(8);
    expect(DEFAULT_CONTENT.probes.map((p) => p.id)).toEqual(['lumen']);
  });
});

describe('referencias rotas', () => {
  test('una sonda con un arma que no existe', () => {
    const c = clone();
    c.probes[0]!.weapon = 'nope';
    expect(() => contentSchema.parse(c)).toThrow(/content_ref:probes\.0\.weapon/);
  });

  test('una especie que se divide en otra inexistente', () => {
    const c = clone();
    const cell = c.enemies.findIndex((e) => e.id === 'cell');
    c.enemies[cell]!.split = { into: 'ghost', count: 2 };
    expect(() => contentSchema.parse(c)).toThrow(new RegExp(`content_ref:enemies\\.${cell}\\.split\\.into`));
  });

  test('un sector con un jefe o una especie inexistentes', () => {
    const c = clone();
    c.sectors[0]!.boss = 'nadie';
    expect(() => contentSchema.parse(c)).toThrow(/content_ref:sectors\.0\.boss/);
    const d = clone();
    d.sectors[0]!.spawns[0]!.enemy = 'nadie';
    expect(() => contentSchema.parse(d)).toThrow(/content_ref:sectors\.0\.spawns\.0\.enemy/);
  });

  test('un jefe que invoca a una especie inexistente', () => {
    const c = clone();
    const phase = c.bosses[0]!.phases[0]!;
    const i = phase.patterns.findIndex((p) => p.kind === 'summon');
    phase.patterns[i] = { kind: 'summon', enemy: 'nadie', count: 3 };
    expect(() => contentSchema.parse(c)).toThrow(/content_ref:bosses\.0\.phases\.0\.patterns\.\d+\.enemy/);
  });

  test('ids repetidos en un catálogo', () => {
    const c = clone();
    c.weapons.push({ ...c.weapons[0]! });
    expect(() => contentSchema.parse(c)).toThrow(/content_dup:weapons/);
  });

  test('fases del jefe desordenadas o que no empiezan con toda la vida', () => {
    const c = clone();
    c.bosses[0]!.phases.reverse();
    expect(() => contentSchema.parse(c)).toThrow(/content_phases:bosses\.0/);
  });

  test('ids de sprite e iconos con mayúsculas o espacios', () => {
    const c = clone();
    c.enemies[0]!.sprite = 'Mite Uno';
    expect(() => contentSchema.parse(c)).toThrow(/"sprite"/);
  });

  test('un arma sin niveles o con más de 8', () => {
    const c = clone();
    c.weapons[0]!.levels = [];
    expect(() => contentSchema.parse(c)).toThrow(/"levels"/);
    const d = clone();
    d.weapons[0]!.levels = Array.from({ length: 9 }, () => d.weapons[0]!.levels[0]!);
    expect(() => contentSchema.parse(d)).toThrow(/"levels"/);
  });

  test('una clave desconocida no se acepta', () => {
    expect(() => contentSchema.parse({ ...clone(), extra: 1 })).toThrow(/extra/);
  });
});
