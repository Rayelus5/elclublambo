import { configJsonSchema, eventBanner, eventCurrency, type EventWarning, type GameEvent, type JsonSchema } from '@galaxy/shared';
import { copy } from '../../copy/es';
import { fmtDate, fmtNumber } from '../forms/format';
import { unwrap } from '../forms/schema';

// What the events screen and its wizard share (polish phase 4): the event's shape for the form, its scanner, and how
// dates, durations, rewards and warnings read.

export const t = copy.admin.events;

export type Banner = {
  id: string;
  kind: 'standard' | 'event';
  name: string;
  pityGroup: string;
  currency: string;
  featured?: { trait: string; value: string };
  startsAt?: string;
  endsAt?: string;
};

/** One event's JSON Schema (an item of `events.list`). */
export const eventSchema = (): JsonSchema => unwrap(unwrap(configJsonSchema('events').properties!.list!).node).node.items!;

/** The schema with only some of its fields, for one step of the wizard. */
export function pick(schema: JsonSchema, keys: string[]): JsonSchema {
  return { ...schema, properties: Object.fromEntries(keys.flatMap((k) => (schema.properties?.[k] ? [[k, schema.properties[k]!]] : []))), required: schema.required?.filter((k) => keys.includes(k)) };
}

export type Phase = 'live' | 'next' | 'past';
export function phaseOf(e: Pick<GameEvent, 'startsAt' | 'endsAt'>, now = Date.now()): Phase {
  if (now < Date.parse(e.startsAt)) return 'next';
  return now < Date.parse(e.endsAt) ? 'live' : 'past';
}

export function duration(startsAt: string, endsAt: string): string {
  const ms = Date.parse(endsAt) - Date.parse(startsAt);
  if (!(ms > 0)) return t.noDuration;
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.round((ms % 86_400_000) / 3_600_000);
  return t.lasts(days, hours);
}

export const range = (startsAt: string, endsAt: string) => `${fmtDate(startsAt)} – ${fmtDate(endsAt)}`;

type Reward = { coins?: number; dust?: number; signal?: number; xp?: number; points?: number; eventSignals?: number };
const r = copy.missions.reward;

/** «200 monedas, 5 señales del evento»: what a reward gives, in words. */
export function rewardText(x: Reward): string {
  const parts: string[] = [];
  if (x.eventSignals) parts.push(r.eventSignals(x.eventSignals));
  if (x.coins) parts.push(r.coins(x.coins));
  if (x.dust) parts.push(r.dust(x.dust));
  if (x.signal) parts.push(r.signal(x.signal));
  if (x.xp) parts.push(r.xp(x.xp));
  if (x.points) parts.push(r.points(x.points));
  return parts.join(', ') || t.nothing;
}

/** What all the goals of a scope give one player, added up. */
export function totals(goals: GameEvent['goals'], scope: 'personal' | 'clan'): Reward {
  const sum: Required<Reward> = { coins: 0, dust: 0, signal: 0, xp: 0, points: 0, eventSignals: 0 };
  for (const g of goals) {
    if ((g.scope ?? 'personal') !== scope) continue;
    for (const k of Object.keys(sum) as (keyof Reward)[]) sum[k] += g.reward?.[k] ?? 0;
  }
  return sum;
}

export const count = (n: number) => fmtNumber(n);

/** The scanner an event has: its own banner, or none. */
export const scannerOf = (e: Pick<GameEvent, 'id'>, banners: Banner[]) => eventBanner(e, banners);

/** The banner of an event's scanner, from the wizard's few fields. */
export function bannerFor(e: Pick<GameEvent, 'id' | 'startsAt' | 'endsAt'>, s: { name: string; trait: string; value: string }): Banner {
  return { id: e.id, kind: 'event', name: s.name, pityGroup: `event-${e.id}`, currency: eventCurrency(e.id), featured: { trait: s.trait, value: s.value }, startsAt: e.startsAt, endsAt: e.endsAt };
}

export function warningText(w: EventWarning, names: Record<string, string>): string {
  switch (w.code) {
    case 'signals_without_scanner':
      return t.warnings.signalsWithoutScanner(names[w.event] ?? w.event);
    case 'scanner_without_signals':
      return t.warnings.scannerWithoutSignals(names[w.event] ?? w.event);
    case 'scanner_dates':
      return t.warnings.scannerDates(names[w.event] ?? w.event);
    case 'scanner_without_event':
      return t.warnings.scannerWithoutEvent(w.banner);
  }
}
