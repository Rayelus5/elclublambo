import { expect, test } from 'vitest';
import { contentRefs, contentSchema, DEFAULT_CONTENT, usesOf, type Content } from '../src/index';

// Where the content names its own entries (the content editor, 2026-11-16, P5): one list the schema checks and the
// editor reads («Se usa en 3 sitios», no removing what is used).

test('dice dónde se usa una entrada', () => {
  const hive = usesOf(DEFAULT_CONTENT, 'bosses', 'hive').map((r) => r.path.join('.'));
  expect(hive).toContain('sectors.0.boss');
  const mite = usesOf(DEFAULT_CONTENT, 'enemies', 'mite').map((r) => r.path.join('.'));
  expect(mite.some((p) => /^sectors\.\d+\.spawns\.\d+\.enemy$/.test(p))).toBe(true);
  expect(usesOf(DEFAULT_CONTENT, 'enemies', 'no-existe')).toEqual([]);
});

test('el esquema comprueba cada referencia de la lista: cambiarla por una que no existe es un problema en su sitio', () => {
  const seen = new Set<string>();
  for (const ref of contentRefs(DEFAULT_CONTENT)) {
    const shape = `${ref.kind}:${ref.path.map((p) => (typeof p === 'number' ? '#' : p)).join('.')}`;
    if (seen.has(shape)) continue;
    seen.add(shape);
    const c = structuredClone(DEFAULT_CONTENT) as unknown as Record<string, unknown>;
    let at = c as Record<string | number, unknown>;
    for (const p of ref.path.slice(0, -1)) at = at[p] as Record<string | number, unknown>;
    at[ref.path.at(-1)!] = 'zz-no-existe';
    const result = contentSchema.safeParse(c as unknown as Content);
    const messages = result.success ? [] : result.error.issues.map((i) => i.message);
    expect(messages, shape).toContain(`content_ref:${ref.path.join('.')}`);
  }
  // Every kind of reference the content has today is in the list.
  expect([...seen].map((s) => s.replace(/:.*/, ''))).toEqual(expect.arrayContaining(['weapons', 'passives', 'enemies', 'bosses']));
});
