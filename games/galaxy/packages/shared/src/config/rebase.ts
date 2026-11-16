// Rebasing a config draft (the content editor, 2026-11-16, P2). A draft keeps only the top-level fields it changes, made
// on the version that was live when editing began (`base`). When someone publishes meanwhile (`live`), each field is
// merged three ways: a list of things with ids entity by entity, an object property by property, anything else whole.
// What only one side changed, that side wins; the same change on both is no conflict; different changes are a conflict
// until a resolution names the winner («mine» keeps the draft's, «live» takes what is published).

export type Side = 'mine' | 'live';
/** Per field: per entity id (lists), per property (objects), or '*' for the whole field. */
export type Resolutions = Record<string, Record<string, Side>>;
export interface Conflict {
  field: string;
  /** The entity (lists) or the property (objects); absent for a field taken whole. */
  id?: string;
}

type Entity = { id: string } & Record<string, unknown>;

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => sameValue(x, bb[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const isIdList = (v: unknown): v is Entity[] => Array.isArray(v) && v.every((x) => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string');
const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** One value three ways; `undefined` stands for «not there». Returns the merged value, or `conflict`. */
function merge3(base: unknown, live: unknown, mine: unknown): { value: unknown } | 'conflict' {
  if (sameValue(mine, base)) return { value: live };
  if (sameValue(live, base) || sameValue(mine, live)) return { value: mine };
  return 'conflict';
}

function mergeList(field: string, base: Entity[], live: Entity[], mine: Entity[], pick: Record<string, Side>, conflicts: Conflict[]): Entity[] {
  const byId = (xs: Entity[]) => new Map(xs.map((x) => [x.id, x]));
  const b = byId(base);
  const l = byId(live);
  const m = byId(mine);
  const decided = new Map<string, Entity | undefined>();
  for (const id of new Set([...b.keys(), ...l.keys(), ...m.keys()])) {
    const r = merge3(b.get(id), l.get(id), m.get(id));
    if (r !== 'conflict') decided.set(id, r.value as Entity | undefined);
    else if (pick[id]) decided.set(id, pick[id] === 'mine' ? m.get(id) : l.get(id));
    else {
      conflicts.push({ field, id });
      decided.set(id, m.get(id));
    }
  }
  // The draft's order; entries only the live side has go after the entry that precedes them there.
  const out: Entity[] = mine.map((x) => decided.get(x.id)).filter((x): x is Entity => !!x);
  live.forEach((x, k) => {
    const value = decided.get(x.id);
    if (!value || out.some((o) => o.id === x.id)) return;
    let at = -1;
    for (let j = k - 1; j >= 0 && at < 0; j--) at = out.findIndex((o) => o.id === live[j]!.id);
    out.splice(at + 1, 0, value);
  });
  return out;
}

function mergeObject(field: string, base: Record<string, unknown>, live: Record<string, unknown>, mine: Record<string, unknown>, pick: Record<string, Side>, conflicts: Conflict[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(live), ...Object.keys(mine)])) {
    const r = merge3(base[key], live[key], mine[key]);
    let value: unknown;
    if (r !== 'conflict') value = r.value;
    else if (pick[key]) value = pick[key] === 'mine' ? mine[key] : live[key];
    else {
      conflicts.push({ field, id: key });
      value = mine[key];
    }
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * The draft's fields over what is live now. `base` and `live` are the whole key (as stored); `mine` only the fields the
 * draft changes. Conflicts keep the draft's side in `fields`, so nothing is lost until they are resolved.
 */
export function rebaseDraft(base: Record<string, unknown>, live: Record<string, unknown>, mine: Record<string, unknown>, resolutions: Resolutions = {}): { fields: Record<string, unknown>; conflicts: Conflict[] } {
  const fields: Record<string, unknown> = {};
  const conflicts: Conflict[] = [];
  for (const [field, value] of Object.entries(mine)) {
    const b = base[field];
    const l = live[field];
    const pick = resolutions[field] ?? {};
    if (sameValue(b, l) || sameValue(value, l)) fields[field] = value;
    else if (isIdList(b) && isIdList(l) && isIdList(value)) fields[field] = mergeList(field, b, l, value, pick, conflicts);
    else if (isPlain(b) && isPlain(l) && isPlain(value)) fields[field] = mergeObject(field, b, l, value, pick, conflicts);
    else if (pick['*']) fields[field] = pick['*'] === 'mine' ? value : l;
    else {
      conflicts.push({ field });
      fields[field] = value;
    }
  }
  return { fields, conflicts };
}
