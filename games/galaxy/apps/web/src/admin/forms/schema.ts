import type { JsonSchema } from '@galaxy/shared';

// Reading a config key's JSON Schema for its form (polish phase 4): what kind of control each node is, a fresh value
// for a new item, and paths into the draft.

export type Kind = 'object' | 'record' | 'list' | 'row' | 'words' | 'number' | 'boolean' | 'enum' | 'datetime' | 'text' | 'variant' | 'fixed' | 'unknown';
export type Path = (string | number)[];

/** A node without its null option: the node itself and whether null is allowed (its default kept). */
export function unwrap(node: JsonSchema): { node: JsonSchema; nullable: boolean } {
  if (!node.anyOf) return { node, nullable: false };
  const rest = node.anyOf.filter((n) => n.type !== 'null');
  const nullable = rest.length < node.anyOf.length;
  if (rest.length === 1) return { node: { ...rest[0], default: node.default ?? rest[0]!.default }, nullable };
  // A union of strings (a fixed word or a pattern, like «signal» or «signal:<event>»): free text.
  if (rest.every((n) => n.type === 'string')) return { node: { type: 'string', default: node.default }, nullable };
  return { node: { ...node, anyOf: rest }, nullable };
}

export function kindOf(node: JsonSchema): Kind {
  if (node.oneOf) return 'variant';
  if (node.const !== undefined) return 'fixed';
  switch (node.type) {
    case 'object':
      if (node.properties) return 'object';
      return node.additionalProperties && typeof node.additionalProperties === 'object' ? 'record' : 'unknown';
    case 'array': {
      const item = unwrap(node.items ?? {}).node;
      if (item.type === 'object' || item.oneOf) return 'list';
      return item.type === 'string' ? 'words' : 'row';
    }
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'string':
      if (node.enum) return 'enum';
      return node.format === 'date-time' ? 'datetime' : 'text';
    default:
      return 'unknown';
  }
}

/** The property every option of a variant fixes («kind»). */
export function discriminatorOf(node: JsonSchema): string | null {
  const first = node.oneOf?.[0]?.properties ?? {};
  return Object.keys(first).find((k) => node.oneOf!.every((o) => o.properties?.[k]?.const !== undefined)) ?? null;
}

/** The option of a variant a value is. */
export function optionOf(node: JsonSchema, value: unknown): JsonSchema | null {
  const d = discriminatorOf(node);
  if (!d || !value || typeof value !== 'object') return node.oneOf?.[0] ?? null;
  return node.oneOf!.find((o) => o.properties?.[d]?.const === (value as Record<string, unknown>)[d]) ?? node.oneOf![0] ?? null;
}

/** The next full hour, as the schemas write dates. */
function nextHour(): string {
  const d = new Date();
  d.setMinutes(60, 0, 0);
  return d.toISOString();
}

/** A fresh value for `node`: its default, or the smallest value that fits. */
export function emptyOf(node: JsonSchema): unknown {
  if (node.default !== undefined) return structuredClone(node.default);
  const { node: n, nullable } = unwrap(node);
  if (n.default !== undefined) return structuredClone(n.default);
  if (nullable) return null;
  switch (kindOf(n)) {
    case 'object': {
      const fresh = Object.fromEntries(
        Object.entries(n.properties!)
          .filter(([k, v]) => n.required?.includes(k) || v.default !== undefined)
          .map(([k, v]) => [k, emptyOf(v)]),
      );
      // Something with a start and an end starts at the next full hour and lasts two days.
      if (typeof fresh.startsAt === 'string' && typeof fresh.endsAt === 'string') fresh.endsAt = new Date(Date.parse(fresh.startsAt) + 2 * 86_400_000).toISOString();
      return fresh;
    }
    case 'record':
      return {};
    case 'list':
    case 'row':
    case 'words':
      return Array.from({ length: n.minItems ?? 0 }, () => emptyOf(n.items ?? {}));
    case 'number': {
      if (n.minimum !== undefined) return n.minimum;
      if (n.exclusiveMinimum !== undefined) return Math.min(n.maximum ?? Infinity, n.exclusiveMinimum + 1);
      return 0;
    }
    case 'boolean':
      return false;
    case 'enum':
      return n.enum![0];
    case 'datetime':
      return nextHour();
    case 'variant':
      return emptyOf(n.oneOf![0]!);
    case 'fixed':
      return n.const;
    default:
      return '';
  }
}

export function getIn(value: unknown, path: Path): unknown {
  let at = value;
  for (const p of path) {
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Record<string | number, unknown>)[p];
  }
  return at;
}

/** `value` with `next` at `path` (undefined removes an object's field), sharing everything else. */
export function setIn<T>(value: T, path: Path, next: unknown): T {
  if (path.length === 0) return next as T;
  const [head, ...rest] = path;
  const inner = setIn(getIn(value, [head!]), rest, next);
  if (Array.isArray(value)) {
    const copy = [...value];
    copy[head as number] = inner;
    return copy as T;
  }
  const copy = { ...((value ?? {}) as Record<string, unknown>) };
  if (inner === undefined) delete copy[head as string];
  else copy[head as string] = inner;
  return copy as T;
}

export const pathKey = (path: Path) => path.join('.');

/**
 * A number typed in Spanish: comma for decimals, dots for thousands («10.000», «1.500,5»). A dot that does not group
 * thousands is a decimal point («0.125», «1.5»), as a technical admin types it.
 */
export function parseNumber(raw: string): number | undefined {
  const s = raw.trim();
  if (s === '') return undefined;
  const grouped = /^-?[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(s);
  const n = Number(grouped ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.'));
  return Number.isNaN(n) ? undefined : n;
}

/**
 * The ids already published, by the list they live in («list[]|fisura», «list[].goals[]|kills»): those name what
 * players have (claims, progress, pity), so a form never changes them, wherever the item has moved.
 */
export function liveIds(value: unknown, pattern = '', out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') out.add(`${pattern}[]|${(item as { id: string }).id}`);
      liveIds(item, `${pattern}[]`, out);
    }
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) liveIds(v, pattern ? `${pattern}.${k}` : k, out);
  }
  return out;
}

/** «Semana de la Fisura» → «semana-de-la-fisura»: an id from a name (lowercase, no accents, dashes, 32 at most). */
export function slugOf(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
}
