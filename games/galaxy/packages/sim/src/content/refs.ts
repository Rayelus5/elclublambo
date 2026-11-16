import type { Content } from './types';

// Where the content names one of its own entries by id (the content editor, 2026-11-16, P5): the schema checks every
// one of them exists from this list, and the editor says where an entry is used («Se usa en 3 sitios») and does not
// let it go while it is. A new field that names an entry goes here, so both learn it at once.

export type RefKind = 'weapons' | 'passives' | 'enemies' | 'bosses';
export interface ContentRef {
  kind: RefKind;
  id: string;
  path: (string | number)[];
}

export function contentRefs(c: Content): ContentRef[] {
  const out: ContentRef[] = [];
  const add = (kind: RefKind, id: string, path: (string | number)[]) => out.push({ kind, id, path });
  c.probes.forEach((p, i) => add('weapons', p.weapon, ['probes', i, 'weapon']));
  c.weapons.forEach((w, i) => {
    if (w.evolution) {
      add('weapons', w.evolution.from, ['weapons', i, 'evolution', 'from']);
      const req = w.evolution.requires;
      if ('passive' in req) add('passives', req.passive, ['weapons', i, 'evolution', 'requires', 'passive']);
    }
    if (w.variant) add('weapons', w.variant.of, ['weapons', i, 'variant', 'of']);
  });
  c.enemies.forEach((e, i) => {
    if (e.split) add('enemies', e.split.into, ['enemies', i, 'split', 'into']);
    if (e.behavior.kind === 'summoner') add('enemies', e.behavior.minion, ['enemies', i, 'behavior', 'minion']);
  });
  c.bosses.forEach((b, i) =>
    b.phases.forEach((ph, j) =>
      ph.patterns.forEach((p, k) => {
        if (p.kind === 'summon') add('enemies', p.enemy, ['bosses', i, 'phases', j, 'patterns', k, 'enemy']);
      }),
    ),
  );
  c.sectors.forEach((s, i) => {
    add('bosses', s.boss, ['sectors', i, 'boss']);
    s.bossCycle?.forEach((b, j) => add('bosses', b, ['sectors', i, 'bossCycle', j]));
    if (s.deepBoss) {
      add('bosses', s.deepBoss.boss, ['sectors', i, 'deepBoss', 'boss']);
      s.deepBoss.cycle?.forEach((b, j) => add('bosses', b, ['sectors', i, 'deepBoss', 'cycle', j]));
    }
    s.spawns.forEach((sp, j) => add('enemies', sp.enemy, ['sectors', i, 'spawns', j, 'enemy']));
    s.waves.forEach((w, j) => add('enemies', w.enemy, ['sectors', i, 'waves', j, 'enemy']));
  });
  return out;
}

/** Where entry `id` of `kind` is named. */
export function usesOf(c: Content, kind: RefKind, id: string): ContentRef[] {
  return contentRefs(c).filter((r) => r.kind === kind && r.id === id);
}
