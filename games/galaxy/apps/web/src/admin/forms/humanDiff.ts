import type { ConfigKey, JsonSchema } from '@galaxy/shared';
import { fmtValue, itemSummary } from './format';
import { fieldInfo, valueName } from './labels';
import { kindOf, optionOf, unwrap } from './schema';

// «Qué cambia» in words (polish phase 4): each change of a draft against what is live, named the way the form names
// it («Temporada › Puntos por incursión › Por capa pasa de 10 a 12»). List items are matched by their id when they
// have one, so moving or editing one says what happened to it, not to its position.

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const join = (trail: string[], last: string) => [...trail, last].join(' › ');

function walk(key: ConfigKey, node: JsonSchema, pattern: string, trail: string[], before: unknown, after: unknown, out: string[], names: Names): void {
  if (same(before, after)) return;
  const n = unwrap(node).node;
  const info = fieldInfo(key, pattern);
  // An item of a list or a named entry is already in the trail by its own name.
  const here = pattern && !pattern.endsWith('[]') && !pattern.endsWith('.*') ? [...trail, info.label] : trail;
  const kind = kindOf(n);
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

  if (kind === 'object' && isObj(before) && isObj(after)) {
    for (const [k, child] of Object.entries(n.properties!)) walk(key, child, pattern ? `${pattern}.${k}` : k, here, before[k], after[k], out, names);
    return;
  }
  if (kind === 'variant' && isObj(before) && isObj(after) && optionOf(n, before) === optionOf(n, after)) {
    const option = optionOf(n, after)!;
    for (const [k, child] of Object.entries(option.properties ?? {})) walk(key, child, `${pattern}.${k}`, here, before[k], after[k], out, names);
    return;
  }
  if (kind === 'record' && isObj(before) && isObj(after)) {
    const value = n.additionalProperties as JsonSchema;
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const name = names[k] ?? valueName(k);
      if (!(k in after)) out.push(`Se quita ${join(here, name)}`);
      else if (!(k in before)) out.push(`Se añade ${join(here, name)}`);
      else walk(key, value, `${pattern}.*`, [...here, name], before[k], after[k], out, names);
    }
    return;
  }
  if (kind === 'list' && Array.isArray(before) && Array.isArray(after)) {
    const item = n.items ?? {};
    const idOf = (x: unknown, i: number) => (isObj(x) && typeof x.id === 'string' ? `id:${x.id}` : `at:${i}`);
    const old = new Map(before.map((x, i) => [idOf(x, i), { x, i }]));
    const now = new Map(after.map((x, i) => [idOf(x, i), { x, i }]));
    const noun = info.noun ?? 'elemento';
    for (const [id, { x, i }] of old) if (!now.has(id)) out.push(`Se quita ${noun} «${itemSummary(info, x, i)}» de ${here.join(' › ')}`);
    for (const [id, { x, i }] of now) {
      const was = old.get(id);
      if (!was) out.push(`Se añade ${noun} «${itemSummary(info, x, i)}» a ${here.join(' › ')}`);
      else walk(key, item, `${pattern}[]`, [...here, itemSummary(info, x, i)], was.x, x, out, names);
    }
    return;
  }
  if (!pattern) return;
  out.push(`${join(trail, info.label)} pasa de ${fmtValue(node, info, before)} a ${fmtValue(node, info, after)}`);
}

/** Names of ids from the live content (a probe, a sector), for named entries. */
export type Names = Record<string, string>;

export function humanDiff(key: ConfigKey, schema: JsonSchema, before: unknown, after: unknown, names: Names = {}): string[] {
  const out: string[] = [];
  walk(key, schema, '', [], before, after, out, names);
  return out;
}

/** Where a problem is, in the form's words: «Eventos › Semana de la Fisura › Metas › Objetivo». */
export function placeOf(key: ConfigKey, schema: JsonSchema, value: unknown, path: string): string {
  if (!path) return '';
  const names: string[] = [];
  let node: JsonSchema = schema;
  let pattern = '';
  let at: unknown = value;
  for (const seg of path.split('.')) {
    const n = unwrap(node).node;
    const kind = kindOf(n);
    const atObj = (at && typeof at === 'object' ? at : {}) as Record<string, unknown>;
    if (kind === 'list' && /^\d+$/.test(seg)) {
      const i = Number(seg);
      names.push(itemSummary(fieldInfo(key, pattern), (at as unknown[] | undefined)?.[i], i));
      node = n.items ?? {};
      pattern = `${pattern}[]`;
      at = (at as unknown[] | undefined)?.[i];
    } else if (kind === 'record') {
      names.push(valueName(seg));
      node = n.additionalProperties as JsonSchema;
      pattern = `${pattern}.*`;
      at = atObj[seg];
    } else if (kind === 'row' || kind === 'words') {
      names.push(`${Number(seg) + 1}`);
      break;
    } else {
      const props = kind === 'variant' ? (optionOf(n, at)?.properties ?? {}) : (n.properties ?? {});
      if (!props[seg]) break;
      pattern = pattern ? `${pattern}.${seg}` : seg;
      names.push(fieldInfo(key, pattern).label);
      node = props[seg]!;
      at = atObj[seg];
    }
  }
  return names.join(' › ');
}
