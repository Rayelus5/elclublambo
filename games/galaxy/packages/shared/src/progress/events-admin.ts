import type { GameEvent } from './missions';

// What the admin's event screen warns about without blocking (polish phase 4). An event can pay its own signals,
// spent on its event scanner (a banner paid with `signal:<event id>`): signals without a scanner are worth nothing, a
// scanner nobody earns signals for sells nothing, and a scanner belongs to its event's dates and to an event that exists.

export interface BannerLike {
  id: string;
  kind: string;
  currency: string;
  startsAt?: string;
  endsAt?: string;
}

export type EventWarning =
  | { code: 'signals_without_scanner'; event: string }
  | { code: 'scanner_without_signals'; event: string }
  | { code: 'scanner_dates'; event: string }
  | { code: 'scanner_without_event'; banner: string };

/** What an event's own signals are called in the wallets and on its scanner. */
export const eventCurrency = (eventId: string) => `signal:${eventId}`;

/** The scanner an event's signals buy, if it has one. */
export function eventBanner<B extends BannerLike>(event: Pick<GameEvent, 'id'>, banners: readonly B[]): B | undefined {
  return banners.find((b) => b.currency === eventCurrency(event.id));
}

export function eventWarnings(events: readonly GameEvent[], banners: readonly BannerLike[]): EventWarning[] {
  const out: EventWarning[] = [];
  for (const e of events) {
    const banner = eventBanner(e, banners);
    const pays = e.goals.some((g) => (g.reward.eventSignals ?? 0) > 0);
    if (pays && !banner) out.push({ code: 'signals_without_scanner', event: e.id });
    if (banner && !pays) out.push({ code: 'scanner_without_signals', event: e.id });
    if (banner && (banner.startsAt !== e.startsAt || banner.endsAt !== e.endsAt)) out.push({ code: 'scanner_dates', event: e.id });
  }
  const ids = new Set(events.map((e) => e.id));
  for (const b of banners) {
    if (b.currency.startsWith('signal:') && !ids.has(b.currency.slice('signal:'.length))) out.push({ code: 'scanner_without_event', banner: b.id });
  }
  return out;
}
