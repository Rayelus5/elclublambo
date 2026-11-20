import { configJsonSchema, type JsonSchema } from '@galaxy/shared';
import { describe, expect, test } from 'vitest';
import { AREAS, areaOf, DESCRIPTORS, PARTS, VOCABS } from '../src/admin/content/descriptors';
import type { VocabName } from '../src/admin/content/descriptors/types';
import { itemsOf, unwrap } from '../src/admin/forms/schema';

// The content editor's descriptors (2026-11-16, P4): every field of the run content has a Spanish name and a hint, every
// value of a choice its name and explanation, every top-level field an area. A field the game adds later fails here
// until it is described — so the editor never shows a raw code name to an admin.

const schema = configJsonSchema('content');

/** Every pattern of the content and its node (lists «[]», records «.*», unions merged). */
function patterns(node: JsonSchema, prefix = '', out = new Map<string, JsonSchema>()): Map<string, JsonSchema> {
  const n = unwrap(node).node;
  if (prefix && !out.has(prefix)) out.set(prefix, n);
  for (const option of [...(n.oneOf ?? []), ...(n.anyOf ?? []).filter((o) => o.type === 'object')]) patterns(option, prefix, out);
  for (const [k, child] of Object.entries(n.properties ?? {})) patterns(child, prefix ? `${prefix}.${k}` : k, out);
  if (n.additionalProperties && typeof n.additionalProperties === 'object') patterns(n.additionalProperties, `${prefix}.*`, out);
  if (n.type === 'array' && !n.prefixItems) {
    const item = unwrap(itemsOf(n)).node;
    if (item.type === 'object' || item.oneOf) patterns(item, `${prefix}[]`, out);
  }
  return out;
}
const ALL = patterns(schema);
const top = (p: string) => p.split(/[.[<]/)[0]!;

/** The values a pattern chooses among: an enum, a union of constants, or the discriminator of a union's options. */
function valuesOf(pattern: string): unknown[] | null {
  const node = ALL.get(pattern)!;
  if (node.enum) return node.enum;
  if (node.prefixItems) {
    const first = unwrap(node.prefixItems[0]!).node;
    return first.enum ?? null;
  }
  if (node.type === 'array') {
    const item = unwrap(itemsOf(node)).node;
    return item.enum ?? null;
  }
  if (node.additionalProperties && typeof node.additionalProperties === 'object') return unwrap(node.additionalProperties).node.enum ?? null;
  // The kind of a union's option: each option fixes it to a constant.
  const parent = pattern.slice(0, pattern.lastIndexOf('.'));
  const key = pattern.slice(pattern.lastIndexOf('.') + 1);
  const holder = parent ? ALL.get(parent) : schema;
  const consts = (holder?.oneOf ?? []).map((o) => o.properties?.[key]?.const).filter((c) => c !== undefined);
  if (consts.length > 0) return consts;
  return node.const !== undefined ? [node.const] : null;
}

describe.each(AREAS.map((a) => [a.id, a] as const))('zona %s', (_id, area) => {
  test('cada campo tiene nombre y explicación', () => {
    const missing = [...ALL.keys()].filter((p) => (area.keys as string[]).includes(top(p))).filter((p) => !DESCRIPTORS[p]?.label?.trim() || !DESCRIPTORS[p]?.hint?.trim());
    expect(missing, `sin describir en ${area.id}`).toEqual([]);
  });

  test('cada elección dice de qué vocabulario son sus valores, y todos están descritos', () => {
    const wrong: string[] = [];
    for (const p of ALL.keys()) {
      if (!(area.keys as string[]).includes(top(p))) continue;
      const values = valuesOf(p);
      if (!values || values.length < 2) continue;
      const vocab = DESCRIPTORS[p]?.vocab;
      if (!vocab) {
        wrong.push(`${p}: sin vocabulario`);
        continue;
      }
      const terms = VOCABS[vocab] ?? {};
      for (const v of values) if (!terms[String(v)]?.label || !terms[String(v)]?.explain) wrong.push(`${p}: ${vocab}.${String(v)}`);
    }
    expect(wrong).toEqual([]);
  });
});

test('cada descripción apunta a un campo que existe', () => {
  const stale = Object.keys(DESCRIPTORS).filter((p) => !ALL.has(p) && !ALL.has(p.replace(/<[^>]*>/g, '')));
  expect(stale).toEqual([]);
});

test('cada campo de primer nivel está en exactamente una zona', () => {
  const placed = AREAS.flatMap((a) => a.keys as string[]);
  for (const key of Object.keys(schema.properties ?? {})) {
    expect(placed.filter((k) => k === key), key).toHaveLength(1);
    expect(areaOf(key)).not.toBe('otros');
  }
});

test('cada vocabulario lo describe un solo archivo', () => {
  const owners = new Map<VocabName, string[]>();
  for (const [file, part] of Object.entries(PARTS)) for (const v of Object.keys(part.vocabs ?? {}) as VocabName[]) owners.set(v, [...(owners.get(v) ?? []), file]);
  for (const [v, files] of owners) expect(files, v).toHaveLength(1);
});

test('los nombres no acaban en punto ni llevan símbolos, y los porcentajes son de campos de 0 a 1', () => {
  const bad: string[] = [];
  for (const [p, d] of Object.entries(DESCRIPTORS)) {
    if (/[.·:—→]$/.test(d.label) || /[·—→]/.test(d.label)) bad.push(`${p}: ${d.label}`);
    if (/\.$/.test(d.hint)) bad.push(`${p}: la explicación acaba en punto`);
    const node = ALL.get(p) ?? ALL.get(p.replace(/<[^>]*>/g, ''));
    if (d.unit === 'percent' && node && unwrap(node).node.type === 'number' && (unwrap(node).node.maximum ?? 2) > 1) bad.push(`${p}: porcentaje de un campo que pasa de 1`);
  }
  for (const [name, vocab] of Object.entries(VOCABS)) for (const [k, term] of Object.entries(vocab ?? {})) if (/\.$/.test(term.explain) || /\.$/.test(term.label)) bad.push(`${name}.${k}: acaba en punto`);
  expect(bad).toEqual([]);
});
