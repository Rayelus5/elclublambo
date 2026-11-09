import { CONFIG_KEYS, type ConfigKey, configJsonSchema, type JsonSchema, parseConfig } from '@galaxy/shared';
import { expect, test } from 'vitest';
import { humanDiff, placeOf } from '../src/admin/forms/humanDiff';
import { issueText } from '../src/admin/forms/issues';
import { CATEGORIES, FIELDS, type FieldInfo, KEY_INFO } from '../src/admin/forms/labels';
import { emptyOf, liveIds, parseNumber, setIn, slugOf, unwrap } from '../src/admin/forms/schema';

// The config forms' words and shape (polish phase 4): every label names a field that exists, every key has a home in
// a category, changes read as sentences, and the checks across fields speak Spanish.

/** Every pattern a key's schema has ("list[].goals[].reward.coins", "unlocks.*.stat"). */
function patterns(node: JsonSchema, prefix = '', out = new Set<string>()): Set<string> {
  const n = unwrap(node).node;
  if (prefix) out.add(prefix);
  for (const option of n.oneOf ?? []) patterns(option, prefix, out);
  for (const [k, child] of Object.entries(n.properties ?? {})) patterns(child, prefix ? `${prefix}.${k}` : k, out);
  if (n.additionalProperties && typeof n.additionalProperties === 'object') patterns(n.additionalProperties, `${prefix}.*`, out);
  if (n.type === 'array' && n.items) {
    const item = unwrap(n.items).node;
    if (item.type === 'object' || item.oneOf) patterns(item, `${prefix}[]`, out);
  }
  return out;
}

test('cada etiqueta del formulario apunta a un campo que existe en su esquema', () => {
  for (const [key, fields] of Object.entries(FIELDS) as [ConfigKey, Record<string, unknown>][]) {
    const known = patterns(configJsonSchema(key));
    for (const path of Object.keys(fields)) expect(known.has(path), `${key}: ${path}`).toBe(true);
  }
});

test('cada clave tiene nombre y está en una categoría de la portada', () => {
  const placed = CATEGORIES.flatMap((c) => c.keys);
  for (const key of CONFIG_KEYS) {
    expect(KEY_INFO[key].title.length).toBeGreaterThan(0);
    expect(placed.filter((k) => k === key)).toHaveLength(1);
  }
});

test('un valor nuevo de cualquier clave pasa su propio esquema donde tiene valores por defecto', () => {
  // A fresh item from the form is a starting point: a boost or an event needs a name and dates the admin writes, but
  // the shape (fields, kinds) is the schema's.
  const boost = emptyOf(unwrap(configJsonSchema('boosts').properties!.list!).node.items!) as Record<string, unknown>;
  expect(Object.keys(boost).sort()).toEqual(['currency', 'endsAt', 'factor', 'id', 'name', 'startsAt']);
  expect(boost.currency).toBe('coins');
  expect(boost.factor).toBe(1);
});

test('qué cambia se dice con los nombres del formulario, en porcentaje y con las listas por su nombre', () => {
  const season = parseConfig('season', {});
  expect(humanDiff('season', configJsonSchema('season'), season, setIn(season, ['points', 'layer'], 12))).toEqual(['Puntos por incursión › Por capa pasa de 10 a 12']);
  const market = parseConfig('market', {});
  expect(humanDiff('market', configJsonSchema('market'), market, { ...market, commission: 0.08 })).toEqual(['Comisión de cada venta pasa de 7 % a 8 %']);
  const boosts = parseConfig('boosts', {});
  const added = { list: [{ id: 'finde', name: 'Doble polvo', currency: 'dust', factor: 2, startsAt: '2026-11-14T00:00:00.000Z', endsAt: '2026-11-16T00:00:00.000Z' }] };
  expect(humanDiff('boosts', configJsonSchema('boosts'), boosts, added)).toEqual(['Se añade multiplicador «Doble polvo» a Multiplicadores']);
  expect(humanDiff('boosts', configJsonSchema('boosts'), added, { list: [{ ...added.list[0], factor: 3 }] })).toEqual(['Multiplicadores › Doble polvo › Por cuánto pasa de ×2 a ×3']);
  const probes = parseConfig('probes', {});
  const { sentinel: _gone, ...rest } = probes.unlocks;
  expect(humanDiff('probes', configJsonSchema('probes'), probes, { ...probes, unlocks: rest }, { sentinel: 'Centinela' })).toEqual(['Se quita Qué desbloquea cada sonda › Centinela']);
});

test('los problemas se sitúan con los nombres del formulario y los códigos se traducen', () => {
  const events = { list: [{ id: 'fisura', name: 'Semana de la Fisura', goals: [{ name: 'Mata 500' }] }] };
  expect(placeOf('events', configJsonSchema('events'), events, 'list.0.goals.0.target')).toBe('Eventos › Semana de la Fisura › Metas › Mata 500 › Objetivo');
  expect(issueText('must_sum_to_1')).toBe('Los porcentajes tienen que sumar 100 %');
  expect(issueText('lab_requires:shield')).toBe('El nodo «shield» necesita uno que no existe');
  expect(issueText('Termina antes de empezar')).toBe('Termina antes de empezar');
});

test('el identificador sale del nombre: minúsculas, sin tildes, con guiones y de 32 como mucho', () => {
  expect(slugOf('Semana de la Fisura')).toBe('semana-de-la-fisura');
  expect(slugOf('¡Doble polvo!  Ñandú')).toBe('doble-polvo-nandu');
  expect(slugOf('Un nombre larguísimo que no cabe en treinta y dos')).toBe('un-nombre-larguisimo-que-no-cabe');
});

/** The node at a pattern ("rewards[].percent"). */
function nodeAt(node: JsonSchema, pattern: string): JsonSchema | undefined {
  let at: JsonSchema | undefined = node;
  for (const seg of pattern.split('.')) {
    if (!at) return undefined;
    const list = seg.endsWith('[]');
    const name = list ? seg.slice(0, -2) : seg;
    at = name === '*' ? (unwrap(at).node.additionalProperties as JsonSchema) : unwrap(at).node.properties?.[name];
    if (list && at) at = unwrap(at).node.items;
  }
  return at;
}

test('solo los campos que se guardan de 0 a 1 se escriben como porcentaje (el álbum va de 1 a 100)', () => {
  for (const [key, fields] of Object.entries(FIELDS) as [ConfigKey, Record<string, FieldInfo>][]) {
    for (const [path, info] of Object.entries(fields)) {
      if (info.unit !== 'percent') continue;
      const n = unwrap(nodeAt(configJsonSchema(key), path)!).node;
      const leaf = n.type === 'array' ? unwrap(n.items!).node : n.type === 'object' ? unwrap(n.additionalProperties as JsonSchema).node : n;
      expect(leaf.maximum, `${key}: ${path}`).toBeLessThanOrEqual(1);
    }
  }
});

test('los números se leen en español: coma decimal y punto de miles', () => {
  expect(parseNumber('10.000')).toBe(10000);
  expect(parseNumber('1.500,5')).toBe(1500.5);
  expect(parseNumber('8,5')).toBe(8.5);
  expect(parseNumber('0.125')).toBe(0.125);
  expect(parseNumber('1.5')).toBe(1.5);
  expect(parseNumber(' 42 ')).toBe(42);
  expect(parseNumber('')).toBeUndefined();
  expect(parseNumber('abc')).toBeUndefined();
});

test('los identificadores publicados se reconocen por su lista, estén donde estén', () => {
  const ids = liveIds({ list: [{ id: 'fisura', goals: [{ id: 'kills' }] }, { id: 'hielo', goals: [] }] });
  expect(ids.has('list[]|fisura')).toBe(true);
  expect(ids.has('list[].goals[]|kills')).toBe(true);
  expect(ids.has('list[]|kills')).toBe(false);
});
