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

/** The entries of a list, skipping what is not one (a content being edited may hold anything while it is wrong). */
type Loose = Record<string, unknown> & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const each = (v: unknown, f: (x: Loose, i: number) => void) => {
  if (Array.isArray(v)) v.forEach((x, i) => x && typeof x === 'object' && f(x as Loose, i));
};

/**
 * Every place the content names one of its entries. A part that is broken (the panel's draft while its JSON is being
 * written) is skipped, and the rest still counts; for a valid content it is exactly what the schema checks.
 */
export function contentRefs(content: Content): ContentRef[] {
  const c = content as unknown as Loose;
  const out: ContentRef[] = [];
  const add = (kind: RefKind, id: unknown, path: (string | number)[]) => {
    if (typeof id === 'string') out.push({ kind, id, path });
  };
  each(c.probes, (p, i) => add('weapons', p.weapon, ['probes', i, 'weapon']));
  each(c.weapons, (w, i) => {
    if (w.evolution && typeof w.evolution === 'object') {
      add('weapons', w.evolution.from, ['weapons', i, 'evolution', 'from']);
      const req = w.evolution.requires;
      if (req && typeof req === 'object' && 'passive' in req) add('passives', req.passive, ['weapons', i, 'evolution', 'requires', 'passive']);
    }
    if (w.variant && typeof w.variant === 'object') add('weapons', w.variant.of, ['weapons', i, 'variant', 'of']);
  });
  each(c.enemies, (e, i) => {
    if (e.split && typeof e.split === 'object') add('enemies', e.split.into, ['enemies', i, 'split', 'into']);
    if (e.behavior?.kind === 'summoner') add('enemies', e.behavior.minion, ['enemies', i, 'behavior', 'minion']);
  });
  each(c.bosses, (b, i) =>
    each(b.phases, (ph, j) =>
      each(ph.patterns, (p, k) => {
        if (p.kind === 'summon') add('enemies', p.enemy, ['bosses', i, 'phases', j, 'patterns', k, 'enemy']);
      }),
    ),
  );
  each(c.sectors, (s, i) => {
    add('bosses', s.boss, ['sectors', i, 'boss']);
    if (Array.isArray(s.bossCycle)) s.bossCycle.forEach((b: unknown, j: number) => add('bosses', b, ['sectors', i, 'bossCycle', j]));
    if (s.deepBoss && typeof s.deepBoss === 'object') {
      add('bosses', s.deepBoss.boss, ['sectors', i, 'deepBoss', 'boss']);
      if (Array.isArray(s.deepBoss.cycle)) s.deepBoss.cycle.forEach((b: unknown, j: number) => add('bosses', b, ['sectors', i, 'deepBoss', 'cycle', j]));
    }
    each(s.spawns, (sp, j) => add('enemies', sp.enemy, ['sectors', i, 'spawns', j, 'enemy']));
    each(s.waves, (w, j) => add('enemies', w.enemy, ['sectors', i, 'waves', j, 'enemy']));
  });
  return out;
}

/** Where entry `id` of `kind` is named. */
export function usesOf(c: Content, kind: RefKind, id: string): ContentRef[] {
  return contentRefs(c).filter((r) => r.kind === kind && r.id === id);
}
