import type { Content } from '@galaxy/sim';

// What the admin debug panel can grant (2026-11-15): every weapon but its variants (a probe's starting sidegrades) and
// evolutions, every passive and every evolution, each with the top level it has.

export interface GrantOption {
  kind: 'weapon' | 'passive' | 'evolution';
  id: string;
  name: string;
  maxLevel: number;
}

export function grantOptions(content: Content): GrantOption[] {
  const out: GrantOption[] = [];
  for (const w of content.weapons) if (!w.variant && !w.evolution) out.push({ kind: 'weapon', id: w.id, name: w.name, maxLevel: w.levels.length });
  for (const p of content.passives) out.push({ kind: 'passive', id: p.id, name: p.name, maxLevel: p.levels.length });
  for (const w of content.weapons) if (w.evolution) out.push({ kind: 'evolution', id: w.id, name: w.name, maxLevel: 1 });
  return out;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** By name or id, ignoring case and accents; an empty query keeps them all. */
export function searchGrants(options: readonly GrantOption[], query: string): GrantOption[] {
  const q = fold(query.trim());
  if (!q) return [...options];
  return options.filter((o) => fold(o.name).includes(q) || o.id.includes(q));
}
