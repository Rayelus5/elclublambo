import type { Content, EventKind } from '@galaxy/sim';
import { copy } from '../copy/es';

/**
 * An in-run event's name in a sector (2026-11-16): the hazards wear each sector's own name, the content's first (P8),
 * else the game's.
 */
export function eventName(kind: EventKind | 'satellite', sector: string, content?: Content): string {
  const hazard = kind === 'meteors' || kind === 'storm' || kind === 'well' ? kind : null;
  const own = hazard ? (content?.sectors.find((s) => s.id === sector)?.hazardNames?.[hazard] ?? copy.arena.events.bySector[sector]?.[hazard]) : undefined;
  return own ?? copy.arena.events[kind].name;
}
