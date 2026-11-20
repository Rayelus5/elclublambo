import { contentRefs } from './refs';
import type { Content } from './types';

// What the content allows but probably does not want (the content editor, 2026-11-16, P7): warnings, never refusals.
// The panel lists them and asks to read them before publishing; `test/content-checks.test.ts` keeps the default content
// free of them. Each has a code (translated by the panel), where it is, and sometimes a name to say.

export interface ContentWarning {
  code: string;
  path: string;
  arg?: string;
}

/** A normal sector should mix at least this many families of enemies. */
export const MIN_FAMILIES = 5;

export function contentWarnings(c: Content): ContentWarning[] {
  const out: ContentWarning[] = [];
  const add = (code: string, path: string, arg?: string) => out.push(arg === undefined ? { code, path } : { code, path, arg });

  // Sectors go from easier to harder: each normal one harder than the one before, the season's the hardest of all.
  const normal = c.sectors.map((s, i) => ({ s, i })).filter(({ s }) => !s.season);
  for (let k = 1; k < normal.length; k++) {
    const { s, i } = normal[k]!;
    const prev = normal[k - 1]!.s;
    if (s.enemyHp <= prev.enemyHp) add('sector_hp_order', `sectors.${i}.enemyHp`, prev.name);
    if (s.coreDamage <= prev.coreDamage) add('sector_core_order', `sectors.${i}.coreDamage`, prev.name);
  }
  c.sectors.forEach((s, i) => {
    if (!s.season) return;
    if (normal.some(({ s: o }) => o.enemyHp > s.enemyHp)) add('season_not_hardest', `sectors.${i}.enemyHp`);
    if (normal.some(({ s: o }) => o.coreDamage > s.coreDamage)) add('season_not_hardest', `sectors.${i}.coreDamage`);
  });

  // A normal sector mixes enough families of enemies.
  const family = new Map(c.enemies.map((e) => [e.id, e.family]));
  for (const { s, i } of normal) {
    const families = new Set(s.spawns.map((sp) => family.get(sp.enemy)).filter(Boolean));
    if (families.size < MIN_FAMILIES) add('sector_families', `sectors.${i}.spawns`, String(families.size));
  }

  // Every base weapon evolves into something.
  const evolves = new Set(c.weapons.flatMap((w) => (w.evolution ? [w.evolution.from] : [])));
  c.weapons.forEach((w, i) => {
    if (!w.evolution && !w.variant && !evolves.has(w.id)) add('weapon_no_evolution', `weapons.${i}`);
  });

  // Every enemy and every Core shows up somewhere.
  const used = new Set(contentRefs(c).map((r) => `${r.kind}:${r.id}`));
  c.enemies.forEach((e, i) => {
    if (!used.has(`enemies:${e.id}`)) add('enemy_unused', `enemies.${i}`);
  });
  c.bosses.forEach((b, i) => {
    if (!used.has(`bosses:${b.id}`)) add('boss_unused', `bosses.${i}`);
  });

  // Per-sector event weights name sectors that exist.
  const sectors = new Set(c.sectors.map((s) => s.id));
  for (const id of Object.keys(c.events.sectors ?? {})) if (!sectors.has(id)) add('events_sector_unknown', `events.sectors.${id}`, id);

  return out;
}
