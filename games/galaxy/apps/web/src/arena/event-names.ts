import type { EventKind } from '@galaxy/sim';
import { copy } from '../copy/es';

/** An in-run event's name in a sector (2026-11-16): the hazards wear each sector's own name. */
export function eventName(kind: EventKind | 'satellite', sector: string): string {
  const own = kind === 'meteors' || kind === 'storm' || kind === 'well' ? copy.arena.events.bySector[sector]?.[kind] : undefined;
  return own ?? copy.arena.events[kind].name;
}
