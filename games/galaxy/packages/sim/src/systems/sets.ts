import type { Content, SetBonus } from '../content/types';
import type { RelicInput } from '../types';

// Relic sets (GDD §8.3, «Conjunto»; plan ruling 5). The same trait on 2 or 3 equipped galaxies (palette, type,
// background, core: the highest tier reached applies), or a galaxy type together with a phenomenon (on the same galaxy
// or on two). Pure, order-independent, and shared by the run and the Hangar.

export interface ActiveSet {
  id: string;
  name: string;
  description: string;
  /** How many galaxies the active tier asked for (combinations: 1 or 2, the galaxies involved). */
  count: number;
  bonus: SetBonus;
  /** The galaxies that make it (ids, sorted). */
  members: string[];
}

export interface PossibleSet {
  id: string;
  name: string;
  /** Galaxies still missing. */
  needs: number;
  /** What the next galaxy needs to have. */
  missing: { trait: string; value: string } | null;
}

const byId = (a: RelicInput, b: RelicInput) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Galaxies grouped by a trait's value (values sorted; galaxies without it are left out). */
function groups(relics: readonly RelicInput[], trait: string): [string, RelicInput[]][] {
  const out = new Map<string, RelicInput[]>();
  for (const r of [...relics].sort(byId)) {
    const v = r.traits[trait];
    if (!v || v === 'none') continue;
    const list = out.get(v) ?? [];
    list.push(r);
    out.set(v, list);
  }
  return [...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function activeSets(relics: readonly RelicInput[], content: Content): ActiveSet[] {
  const out: ActiveSet[] = [];
  const sorted = [...relics].sort(byId);
  for (const s of content.relics.sets) {
    if (s.kind === 'same') {
      for (const [, members] of groups(relics, s.trait)) {
        let tier: (typeof s.tiers)[number] | undefined;
        for (const t of s.tiers) if (members.length >= t.count) tier = t;
        if (tier) out.push({ id: s.id, name: s.name, description: s.description, count: tier.count, bonus: tier.bonus, members: members.map((r) => r.id) });
      }
    } else {
      const typed = sorted.find((r) => r.traits['galaxy_type'] === s.type);
      if (!typed) continue;
      const shining = typed.traits['phenomenon'] === s.phenomenon ? typed : sorted.find((r) => r.traits['phenomenon'] === s.phenomenon);
      if (!shining) continue;
      const members = [...new Set([typed.id, shining.id])].sort();
      out.push({ id: s.id, name: s.name, description: s.description, count: members.length, bonus: s.bonus, members });
    }
  }
  return out;
}

/** Sets one galaxy away: a combination with one side equipped, or a same-trait set that has a bigger tier. */
export function possibleSets(relics: readonly RelicInput[], content: Content): PossibleSet[] {
  const out: PossibleSet[] = [];
  for (const s of content.relics.sets) {
    if (s.kind === 'same') {
      for (const [value, members] of groups(relics, s.trait)) {
        const next = s.tiers.find((t) => t.count > members.length);
        if (next && members.length >= 2) out.push({ id: s.id, name: s.name, needs: next.count - members.length, missing: { trait: s.trait, value } });
      }
    } else {
      const typed = relics.some((r) => r.traits['galaxy_type'] === s.type);
      const shining = relics.some((r) => r.traits['phenomenon'] === s.phenomenon);
      if (typed && !shining) out.push({ id: s.id, name: s.name, needs: 1, missing: { trait: 'phenomenon', value: s.phenomenon } });
      else if (shining && !typed) out.push({ id: s.id, name: s.name, needs: 1, missing: { trait: 'galaxy_type', value: s.type } });
    }
  }
  return out;
}
