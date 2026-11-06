import { TRAITS } from './config/generated';
import type { Condition, TraitKey, Traits, TraitSpec } from './config/types';
import type { Generator } from './rng/generator';
import { sha256Hex } from './rng/sha256';

// TraitSampler from galaxy-nft (ENGINE_PORT §3.1–§3.3), same semantics and same random-number consumption.
type Context = Readonly<Record<string, string | undefined>>;

function matches(condition: Condition | undefined, ctx: Context): boolean {
  if (!condition) return true;
  for (const [key, allowed] of Object.entries(condition)) {
    const value = ctx[key];
    if (value === undefined || !allowed.includes(value)) return false;
  }
  return true;
}

function forced(key: string, ctx: Context): string | undefined {
  for (const rule of TRAITS.rules) {
    if (!('force' in rule)) continue;
    const { when, set } = rule.force;
    if (key in set && Object.entries(when).every(([k, v]) => ctx[k] === v)) return set[key];
  }
  return undefined;
}

/** A value is forbidden when it completes every condition of some `forbid` rule. */
function forbidden(key: string, value: string, ctx: Context): boolean {
  for (const rule of TRAITS.rules) {
    if (!('forbid' in rule)) continue;
    const forbid = rule.forbid;
    if (!forbid[key]?.includes(value)) continue;
    const others = Object.entries(forbid).filter(([k]) => k !== key);
    if (others.every(([k, allowed]) => ctx[k] !== undefined && allowed.includes(ctx[k]))) return true;
  }
  return false;
}

function spec(key: string): TraitSpec {
  const s = (TRAITS.traits as Readonly<Record<string, TraitSpec>>)[key];
  if (!s) throw new RangeError(`unknown trait ${key}`);
  return s;
}

/**
 * Draws every trait in draw order. Fixed values count for the rules of the traits that are drawn, even when they
 * come later in the order. Each drawn trait consumes exactly one double (`choiceP`), even with a single candidate;
 * fixed, forced and absent traits consume none.
 */
export function drawTraits(rng: Generator, fixed?: Partial<Traits>): Traits {
  const pinned: Record<string, string> = {};
  for (const [k, v] of Object.entries(fixed ?? {})) if (v !== undefined) pinned[k] = String(v);
  const chosen: Record<string, string> = {};
  for (const key of TRAITS.drawOrder) {
    const s = TRAITS.traits[key];
    const ctx = { ...pinned, ...chosen };
    if (!matches(s.requires, ctx)) continue;
    let value: string;
    const pin = pinned[key];
    const force = pin === undefined ? forced(key, ctx) : undefined;
    if (pin !== undefined) {
      if (!s.values.some((v) => v.value === pin)) throw new RangeError(`unknown value for ${key}: ${pin}`);
      value = pin;
    } else if (force !== undefined) {
      value = force;
    } else {
      const candidates = s.values.filter((v) => matches(v.requires, ctx) && !forbidden(key, v.value, ctx));
      if (candidates.length === 0) throw new RangeError(`no value of ${key} is compatible with ${JSON.stringify(ctx)}`);
      const total = candidates.reduce((sum, v) => sum + v.weight, 0);
      value = candidates[rng.choiceP(candidates.map((v) => v.weight / total))]!.value;
    }
    chosen[key] = value;
  }
  return chosen as Traits;
}

/** SHA-256 of `key=value|…` in draw order, over the traits present (lowercase hex). */
export function dna(traits: Traits): string {
  const t = traits as Readonly<Record<string, string | undefined>>;
  return sha256Hex(
    TRAITS.drawOrder
      .filter((k) => t[k] !== undefined)
      .map((k) => `${k}=${t[k]}`)
      .join('|'),
  );
}

// Python's repr() of the small dicts and lists in the messages, so violations() reads exactly like the original.
function pyRepr(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`)
      .join(', ')}}`;
  }
  if (typeof value === 'string') {
    return value.includes("'") && !value.includes('"')
      ? `"${value}"`
      : `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }
  return String(value);
}

/** Human-readable list of the rules a combination breaks (to validate fixed values), as in galaxy-nft. */
export function violations(traits: Partial<Traits>): string[] {
  const chosen = traits as Readonly<Record<string, string | undefined>>;
  const problems: string[] = [];
  for (const [key, value] of Object.entries(chosen)) {
    if (value === undefined) continue;
    const s = spec(key);
    const v = s.values.find((x) => x.value === value);
    if (!v) throw new RangeError(`unknown value for ${key}: ${value}`);
    if (!matches(s.requires, chosen)) problems.push(`${key} no aplica con ${pyRepr(s.requires)}`);
    if (!matches(v.requires, chosen)) problems.push(`${key}=${value} requiere ${pyRepr(v.requires)}`);
    if (forbidden(key, value, chosen)) problems.push(`${key}=${value} está prohibido en esta combinación`);
  }
  for (const rule of TRAITS.rules) {
    if (!('force' in rule)) continue;
    const { when, set } = rule.force;
    if (!Object.entries(when).every(([k, v]) => chosen[k] === v)) continue;
    for (const [k, v] of Object.entries(set)) {
      if (chosen[k] !== undefined && chosen[k] !== v) problems.push(`${k} debería ser ${v} cuando ${pyRepr(when)}`);
    }
  }
  return problems;
}

export type { TraitKey };
