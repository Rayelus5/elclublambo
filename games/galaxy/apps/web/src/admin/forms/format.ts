import type { JsonSchema } from '@galaxy/shared';
import { type FieldInfo, itemName, UNIT_SUFFIX, valueName } from './labels';
import { kindOf, unwrap } from './schema';

// How the config forms show values (polish phase 4): numbers in Spanish, shares as percentages, dates in the admin's
// own time, and a short name for each item of a list.

const num = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 4 });
const when = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
const whenUtc = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

/** Shares are kept from 0 to 1 and shown from 0 to 100. */
export const scaleOf = (info: FieldInfo) => (info.unit === 'percent' ? 100 : 1);
/** Rounds away float noise (0.07 × 100 = 7.000000000000001). */
export const tidy = (x: number) => Math.round(x * 1e9) / 1e9;

export const fmtNumber = (x: number) => num.format(x);
export const fmtDate = (iso: string) => when.format(new Date(iso));
export const fmtUtc = (iso: string) => whenUtc.format(new Date(iso));

/** «2026-11-01T00:00:00.000Z» → the value of a datetime-local input in the admin's time. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).padStart(4, '0')}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(local: string): string | undefined {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** A value as a sentence would say it. */
export function fmtValue(node: JsonSchema, info: FieldInfo, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'nada';
  const inner = unwrap(node).node;
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (typeof v === 'number') {
    const unit = info.unit;
    const shown = fmtNumber(tidy(v * scaleOf(info)));
    if (!unit) return shown;
    return unit === 'percent' ? `${shown} %` : unit === 'factor' ? `×${shown}` : `${shown} ${UNIT_SUFFIX[unit]}`;
  }
  if (Array.isArray(v)) return v.map((x) => fmtValue(inner.items ?? {}, info, x)).join(', ');
  if (typeof v === 'string') {
    if (kindOf(inner) === 'datetime') return fmtDate(v);
    if (kindOf(inner) === 'enum') return valueName(v);
    return `«${v}»`;
  }
  return JSON.stringify(v);
}

/** A short name for item `i` of a list: its name, title or id, what it rewards or where it sits. */
export function itemSummary(info: FieldInfo, item: unknown, i: number): string {
  const fixed = itemName(info, i);
  if (fixed) return fixed;
  const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
  for (const k of ['name', 'title', 'id']) if (typeof o[k] === 'string' && o[k]) return o[k] as string;
  if (typeof o.at === 'number') return `A los ${fmtNumber(o.at)} puntos`;
  if (typeof o.percent === 'number') return `Al ${fmtNumber(o.percent)} %`;
  return `${info.noun ? info.noun.charAt(0).toUpperCase() + info.noun.slice(1) : 'Elemento'} ${i + 1}`;
}
