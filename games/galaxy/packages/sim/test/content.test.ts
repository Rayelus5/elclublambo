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
    expect(DEFAULT_CONTENT.sectors[0]!.id).toBe('outer-nebula');
    expect(DEFAULT_CONTENT.enemies.map((e) => e.id)).toEqual(expect.arrayContaining(['cell', 'cellet', 'mite', 'ray', 'shell', 'spitter']));
    expect(DEFAULT_CONTENT.bosses[0]!.id).toBe('hive');
    expect(DEFAULT_CONTENT.weapons.map((w) => w.id)).toEqual(expect.arrayContaining(['pulse', 'nova', 'lance', 'orbit', 'trail', 'arc', 'drone']));
    expect(DEFAULT_CONTENT.passives).toHaveLength(25);
    expect(DEFAULT_CONTENT.probes.map((p) => p.id)).toEqual(['lumen', 'bastion', 'spark', 'sentinel', 'anchor', 'prism', 'comet', 'echo']);
  });

  test('M3b-3: cinco sectores con sus biomas, 25 especies y 6 Núcleos', () => {
    expect(DEFAULT_CONTENT.sectors.map((s) => [s.id, s.biome])).toEqual([
      ['outer-nebula', 'nebula'],
      ['frost-rings', 'ice'],
      ['hollow-reef', 'reef'],
      ['broken-forge', 'forge'],
      ['signal-rift', 'rift'],
    ]);
    expect(DEFAULT_CONTENT.enemies).toHaveLength(25);
    expect(DEFAULT_CONTENT.bosses.map((b) => b.id).sort()).toEqual(['anemone', 'anvil', 'echo-core', 'glacier', 'hive', 'signal']);
  });

  test('cada sector normal: al menos 5 familias, su propio Núcleo y el Núcleo profundo cada 4 capas; solo la Fisura es de temporada', () => {
    const normal = DEFAULT_CONTENT.sectors.filter((s) => !s.season);
    expect(DEFAULT_CONTENT.sectors.filter((s) => s.season).map((s) => s.id)).toEqual(['signal-rift']);
    expect(new Set(DEFAULT_CONTENT.sectors.map((s) => s.boss)).size).toBe(5);
    for (const s of normal) {
      const families = new Set(s.spawns.map((sp) => DEFAULT_CONTENT.enemies.find((e) => e.id === sp.enemy)!.family));
      expect(families.size, s.id).toBeGreaterThanOrEqual(5);
      expect(s.deepBoss, s.id).toEqual({ boss: 'echo-core', every: 4 });
    }
    const rift = DEFAULT_CONTENT.sectors.find((s) => s.season)!;
    expect(rift.deepBoss).toBeNull();
    expect(rift.boss).toBe('signal');
  });

  test('aparecen las 7 familias, cada comportamiento nuevo y cada patrón de jefe nuevo', () => {
    expect(new Set(DEFAULT_CONTENT.enemies.map((e) => e.family))).toEqual(new Set(['swarm', 'charger', 'shooter', 'splitter', 'armored', 'healer', 'summoner']));
    const kinds = new Set(DEFAULT_CONTENT.enemies.map((e) => e.behavior.kind));
    for (const k of ['orbit', 'support', 'blink', 'lancer']) expect(kinds.has(k as never), k).toBe(true);
    expect(DEFAULT_CONTENT.enemies.some((e) => e.behavior.kind === 'armored' && e.behavior.weakTo)).toBe(true);
    const patterns = new Set(DEFAULT_CONTENT.bosses.flatMap((b) => b.phases.flatMap((p) => p.patterns.map((x) => x.kind))));
    for (const k of ['wall', 'mines', 'blink']) expect(patterns.has(k as never), k).toBe(true);
  });

  test('cada inicial destaca en su estadística fuerte: Lumen recoge de lejos, Bastión aguanta, Chispa corre', () => {
    // GDD §6: every probe has «una estadística fuerte», and what the test reveals («rápida», «no se mueve») is true.
    const [lumen, bastion, spark] = ['lumen', 'bastion', 'spark'].map((id) => DEFAULT_CONTENT.probes.find((p) => p.id === id)!);
    expect(lumen!.pickup).toBeGreaterThanOrEqual(1.1 * Math.max(bastion!.pickup, spark!.pickup));
    expect(bastion!.hp).toBeGreaterThanOrEqual(1.2 * Math.max(lumen!.hp, spark!.hp));
    expect(spark!.speed).toBeGreaterThanOrEqual(1.1 * Math.max(lumen!.speed, bastion!.speed));
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

describe('el arsenal', () => {
  const level = { damage: 26, cooldown: 0.32, count: 4, pierce: 0, speed: 380, area: 0, duration: 0, range: 300, bounces: 0, knockback: 0, interval: 0 };
  const evo = (over: Partial<Content['weapons'][number]> = {}): Content['weapons'][number] => ({
    id: 'pulse-storm',
    name: 'Tormenta de pulsos',
    kind: 'bolt',
    icon: 'icon-pulse',
    description: 'Ráfagas que se parten al golpear',
    levels: [level],
    special: 'split',
    element: null,
    evolution: { from: 'pulse', requires: { passive: 'capacitor' } },
    ...over,
  });
  const withWeapons = (...extra: Content['weapons']) => {
    const c = clone();
    c.weapons = c.weapons.filter((w) => !w.evolution);
    c.weapons.push(...extra);
    return c;
  };

  test('trae las 20 pasivas, con las 6 estadísticas nuevas', () => {
    const stats = new Set(DEFAULT_CONTENT.passives.map((p) => p.stat));
    for (const s of ['velocity', 'duration', 'pierce', 'elemental', 'barrier', 'curse']) expect(stats.has(s as never)).toBe(true);
    expect(DEFAULT_CONTENT.caps).toMatchObject({ velocity: 1, duration: 1, pierce: 5, elemental: 1, barrier: 0.3, curse: 0.5 });
  });

  test('una evolución válida pasa', () => {
    expect(() => contentSchema.parse(withWeapons(evo()))).not.toThrow();
  });

  test('una evolución de un arma que no existe', () => {
    expect(() => contentSchema.parse(withWeapons(evo({ evolution: { from: 'nope', requires: { passive: 'capacitor' } } })))).toThrow(/content_ref:weapons\.\d+\.evolution\.from/);
  });

  test('una evolución que pide una pasiva que no existe', () => {
    expect(() => contentSchema.parse(withWeapons(evo({ evolution: { from: 'pulse', requires: { passive: 'nope' } } })))).toThrow(
      /content_ref:weapons\.\d+\.evolution\.requires\.passive/,
    );
  });

  test('evoluciones imposibles: de otra evolución, de otro tipo, dos del mismo arma o con más de un nivel', () => {
    const chained = evo({ id: 'storm-2', evolution: { from: 'pulse-storm', requires: { passive: 'capacitor' } } });
    expect(() => contentSchema.parse(withWeapons(evo(), chained))).toThrow(/content_evolution/);
    expect(() => contentSchema.parse(withWeapons(evo({ kind: 'nova' })))).toThrow(/content_evolution/);
    expect(() => contentSchema.parse(withWeapons(evo(), evo({ id: 'pulse-storm-b' })))).toThrow(/content_evolution/);
    expect(() => contentSchema.parse(withWeapons(evo({ levels: [level, level] })))).toThrow(/content_evolution/);
  });

  test('un especial desconocido no se acepta', () => {
    expect(() => contentSchema.parse(withWeapons(evo({ special: 'laser' as never })))).toThrow();
  });

  const reaction = (over: Partial<Content['elements']['reactions'][number]> = {}): Content['elements']['reactions'][number] => ({
    id: 'short-circuit',
    name: 'Cortocircuito',
    pair: ['corrosion', 'shock'],
    effect: { kind: 'chain', targets: 5, range: 120, share: 0.8 },
    ...over,
  });

  test('reacciones: una válida pasa; un elemento inexistente, una pareja igual o repetida no', () => {
    const ok = clone();
    ok.elements.reactions = [reaction()];
    expect(() => contentSchema.parse(ok)).not.toThrow();
    const unknown = clone();
    unknown.elements.reactions = [reaction({ pair: ['corrosion', 'plasma' as never] })];
    expect(() => contentSchema.parse(unknown)).toThrow(/reactions/);
    const same = clone();
    same.elements.reactions = [reaction({ pair: ['shock', 'shock'] })];
    expect(() => contentSchema.parse(same)).toThrow(/content_reaction/);
    const twice = clone();
    twice.elements.reactions = [reaction(), reaction({ id: 'other', pair: ['shock', 'corrosion'] })];
    expect(() => contentSchema.parse(twice)).toThrow(/content_reaction/);
  });

  const set = (over: Partial<Content['relics']['sets'][number]> = {}): Content['relics']['sets'][number] =>
    ({
      id: 'resonance',
      name: 'Resonancia cromática',
      description: 'Dos galaxias de la misma paleta',
      kind: 'same',
      trait: 'palette',
      tiers: [
        { count: 2, bonus: { stats: [{ stat: 'elemental', value: 0.25 }] } },
        { count: 3, bonus: { stats: [{ stat: 'elemental', value: 0.5 }] } },
      ],
      ...over,
    }) as Content['relics']['sets'][number];

  test('conjuntos: uno válido pasa; un rasgo desconocido o umbrales que no crecen no', () => {
    const ok = clone();
    ok.relics.sets = [set(), { id: 'satellite-arm', name: 'Brazo satélite', description: 'Espiral y galaxia satélite', kind: 'combo', type: 'spiral', phenomenon: 'satellite_galaxy', bonus: { stats: [{ stat: 'projectiles', value: 1 }] } }];
    expect(() => contentSchema.parse(ok)).not.toThrow();
    const trait = clone();
    trait.relics.sets = [set({ trait: 'arms' as never })];
    expect(() => contentSchema.parse(trait)).toThrow(/sets/);
    const order = clone();
    order.relics.sets = [set({ tiers: [{ count: 3, bonus: {} }, { count: 2, bonus: {} }] } as never)];
    expect(() => contentSchema.parse(order)).toThrow(/content_set/);
  });

  test('una experiencia que no crece congelaría la partida: base 0 no se acepta', () => {
    const c = clone();
    c.xp = { base: 0, linear: 0, quad: 0 };
    expect(() => contentSchema.parse(c)).toThrow();
  });
});
