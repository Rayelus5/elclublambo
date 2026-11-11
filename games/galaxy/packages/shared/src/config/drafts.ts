import type { ConfigKey } from './registry';

// Drafts that start from what is live (docs/CONTENIDO.md A4). Publishing replaces whole top-level fields, so a draft
// built from this build's defaults alone would undo the owner's edits in the panel; the CLI's draft-config builds it
// from the published value instead and takes from the defaults only what is new (or the ids asked for).

/** The order keys are published in, so each finds what it depends on already live (CONTENIDO.md B3). */
export const PUBLISH_ORDER: readonly ConfigKey[] = ['content', 'sectors', 'probes', 'relics', 'season', 'lab', 'seasonRoute', 'missions', 'achievements', 'boosts', 'events', 'gacha'];

type WithId = { id: string };
const isIdList = (v: unknown): v is WithId[] =>
  Array.isArray(v) && v.every((x) => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string');

/**
 * One field of a draft: for a list of things with ids, the live list plus the defaults' entries it lacks (each placed
 * after the entry that precedes it in the defaults), or with `ids` only those entries, replacing the live one or
 * added. Anything else is the defaults' value whole. Throws `not_a_list` (ids for a field that is not a list of things
 * with ids) or `id_not_in_defaults:<id>`.
 */
export function draftFromDefaults(live: unknown, defaults: unknown, ids?: readonly string[]): unknown {
  if (!isIdList(defaults) || !isIdList(live)) {
    if (ids && ids.length > 0) throw new Error('not_a_list');
    return defaults;
  }
  const order = defaults.map((d) => d.id);
  for (const id of ids ?? []) if (!order.includes(id)) throw new Error(`id_not_in_defaults:${id}`);
  const out = live.slice();
  const targets = ids ?? defaults.map((d) => d.id).filter((id) => !live.some((l) => l.id === id));
  for (const id of order.filter((x) => targets.includes(x))) {
    const entry = defaults.find((d) => d.id === id)!;
    const at = out.findIndex((x) => x.id === id);
    if (at >= 0) {
      out[at] = entry;
      continue;
    }
    // After the nearest entry that precedes it in the defaults and is already in the draft; first if none is.
    let after = -1;
    for (let k = order.indexOf(id) - 1; k >= 0 && after < 0; k--) after = out.findIndex((x) => x.id === order[k]);
    out.splice(after + 1, 0, entry);
  }
  return out;
}
