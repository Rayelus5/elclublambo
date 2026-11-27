import { type Content, type Offer, type Special, type StatKey, WEAPON_FIELDS, type WeaponDef, type WeaponKind, type WeaponLevel } from '@galaxy/sim';
import { copy } from '../../copy/es';

// What a level-up gives (the owner, 2026-11-27): every card of «Elige una mejora» says what that level adds, in a short
// green line. It is read from the content's own numbers, so it is right for every power at every level, the admin's
// changes included: a weapon, the numbers its kind reads that change from the level you have to the one you take; a
// passive, what its stat adds at that level (its levels are running totals); an evolution, what it gains over its weapon
// at the top and its trait; a new weapon, its starting numbers. Stacking with relics and the game's caps may soften a
// passive in the run: the line says what the card itself gives.

export type Gain =
  /** A weapon's number from its level to the next (`kind` names what it fires, for the count). */
  | { kind: 'weapon'; field: keyof WeaponLevel; from: number; to: number; unit: WeaponKind }
  /** A new weapon's starting number. */
  | { kind: 'base'; field: 'damage' | 'cooldown' | 'count'; value: number; unit: WeaponKind }
  /** A passive's stat: what this level adds (`total`: where it gets). */
  | { kind: 'stat'; stat: StatKey; value: number; total: number }
  /** An evolution's trait. */
  | { kind: 'special'; special: Special };

const EPS = 1e-9;
/** What matters most goes first (a card may only have room for the first few): more of it, harder, sooner. */
const ORDER: readonly (keyof WeaponLevel)[] = ['count', 'damage', 'cooldown', 'pierce', 'bounces', 'area', 'range', 'duration', 'interval', 'speed', 'knockback'];

function weaponGains(def: WeaponDef, from: WeaponLevel, to: WeaponLevel, kind: WeaponKind): Gain[] {
  const out: Gain[] = [];
  for (const field of ORDER) {
    if (!WEAPON_FIELDS[kind].includes(field)) continue;
    // Through everything: how many it went through before says nothing.
    if (field === 'pierce' && def.special === 'pierceAll') continue;
    const a = from[field];
    const b = to[field];
    if (Math.abs(a - b) > EPS) out.push({ kind: 'weapon', field, from: a, to: b, unit: def.kind });
  }
  return out;
}

export function offerGains(content: Content, o: Offer): Gain[] {
  if (o.kind === 'heal') return [];
  if (o.kind === 'passive') {
    const def = content.passives.find((p) => p.id === o.id);
    if (!def) return [];
    const total = def.levels[o.level - 1] ?? 0;
    const before = o.level >= 2 ? (def.levels[o.level - 2] ?? 0) : 0;
    return Math.abs(total - before) > EPS ? [{ kind: 'stat', stat: def.stat, value: total - before, total }] : [];
  }
  const def = content.weapons.find((w) => w.id === o.id);
  if (!def) return [];
  if (o.kind === 'evolve') {
    const base = content.weapons.find((w) => w.id === def.evolution?.from);
    const top = base?.levels.at(-1);
    const own = def.levels[0];
    // Its trait first: what makes it more than a stronger weapon.
    const out: Gain[] = def.special ? [{ kind: 'special', special: def.special }] : [];
    if (top && own && base?.kind === def.kind) out.push(...weaponGains(def, top, own, def.kind));
    return out;
  }
  const to = def.levels[o.level - 1];
  if (!to) return [];
  if (o.level === 1) {
    const fields = WEAPON_FIELDS[def.kind];
    const out: Gain[] = [{ kind: 'base', field: 'damage', value: to.damage, unit: def.kind }];
    if (fields.includes('cooldown')) out.push({ kind: 'base', field: 'cooldown', value: to.cooldown, unit: def.kind });
    if (fields.includes('count')) out.push({ kind: 'base', field: 'count', value: to.count, unit: def.kind });
    return out;
  }
  const from = def.levels[o.level - 2];
  return from ? weaponGains(def, from, to, def.kind) : [];
}

/** Each gain in words (copy.arena.gains), in the content's order. */
export function gainLines(gains: readonly Gain[]): string[] {
  const g = copy.arena.gains;
  return gains.map((x) => {
    switch (x.kind) {
      case 'weapon':
        return g.weapon(x.field, x.from, x.to, x.unit);
      case 'base':
        return g.base(x.field, x.value, x.unit);
      case 'stat':
        return g.stat(x.stat, x.value, x.total);
      case 'special':
        return g.special[x.special];
    }
  });
}

/**
 * A card's before-and-after rows (design C, the owner's pick, 2026-11-27): each number with what you have and what
 * you get (`from` is null on a new weapon or a passive's first level), or an evolution's trait. `say` is the whole
 * sentence for screen readers (the rows draw an arrow icon between the values, never a text arrow).
 */
export type GainRow = { kind: 'value'; label: string; from: string | null; to: string; say: string } | { kind: 'trait'; text: string };

export function gainRows(gains: readonly Gain[]): GainRow[] {
  const g = copy.arena.gains;
  const says = gainLines(gains);
  return gains.map((x, i): GainRow => {
    const say = says[i]!;
    switch (x.kind) {
      case 'special':
        return { kind: 'trait', text: say };
      case 'base':
        return { kind: 'value', label: g.rowLabel(x.field, x.unit), from: null, to: g.rowValue(x.field, x.value), say };
      case 'stat': {
        const before = x.total - x.value;
        return { kind: 'value', label: g.statLabel(x.stat), from: Math.abs(before) > EPS ? g.statValue(x.stat, before) : null, to: g.statValue(x.stat, x.total), say };
      }
      case 'weapon':
        return { kind: 'value', label: g.rowLabel(x.field, x.unit), from: g.rowValue(x.field, x.from), to: g.rowValue(x.field, x.to), say };
    }
  });
}
