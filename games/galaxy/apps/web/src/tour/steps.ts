import type { OnboardingView, TutorialChapter } from '@galaxy/shared';
import { copy } from '../copy/es';
import type { TourEvent } from './bus';

// The tour's steps (GDD §12.2; polish phase 3), chapter by chapter. Each points at an element marked data-tour="…"
// (or none: a centred card), says one thing in PERKINS's few words, and either waits for «Siguiente» (info) or for the
// player to do it (action: an event or reaching a screen). A step already done in the game is skipped.

export interface TourStep {
  id: string;
  chapter: TutorialChapter;
  /** The screen it happens on (the router's path, without /galaxy). */
  route: string;
  target?: string;
  kind: 'info' | 'action';
  text: (ctx: { gift: number }) => string;
  advance?: { event?: TourEvent; route?: string };
  /** A button in the card that takes the player there. */
  go?: { to: string; label: string };
  /** The card sits in a corner and leaves the screen alone (a panel or the reveal is open). */
  docked?: boolean;
  /** Nothing on screen: the arena coaches this one. */
  hidden?: boolean;
  skipIf?: (o: OnboardingView | undefined) => boolean;
}

const t = copy.tour;

export const TOUR_STEPS: TourStep[] = [
  { id: 'hub-hello', chapter: 'hub', route: '/', kind: 'info', text: () => t.hub.hello },
  { id: 'hub-wallet', chapter: 'hub', route: '/', target: 'wallet', kind: 'info', text: () => t.hub.wallet },
  { id: 'hub-play', chapter: 'hub', route: '/', target: 'play', kind: 'info', text: () => t.hub.play },
  { id: 'hub-home', chapter: 'hub', route: '/', target: 'home', kind: 'info', text: () => t.hub.home },
  { id: 'hub-scanner', chapter: 'hub', route: '/', target: 'scanner', kind: 'action', text: () => t.hub.scanner, advance: { route: '/escaner' } },

  { id: 'scan-odds', chapter: 'scanner', route: '/escaner', target: 'odds', kind: 'info', text: () => t.scanner.odds },
  { id: 'scan-pity', chapter: 'scanner', route: '/escaner', target: 'pity', kind: 'info', text: () => t.scanner.pity },
  { id: 'scan-pull', chapter: 'scanner', route: '/escaner', target: 'pull10', kind: 'action', text: () => t.scanner.pull, advance: { event: 'scanner:pulled' }, skipIf: (o) => !!o?.welcomePulls },
  { id: 'scan-reveal', chapter: 'scanner', route: '/escaner', kind: 'action', docked: true, text: () => t.scanner.reveal, advance: { event: 'scanner:revealClosed' }, skipIf: (o) => !!o?.welcomePulls },
  { id: 'scan-relics', chapter: 'scanner', route: '/escaner', kind: 'action', text: () => t.scanner.relics, go: { to: '/incursion', label: t.scanner.toHangar }, advance: { route: '/incursion' } },

  { id: 'hangar-sector', chapter: 'hangar', route: '/incursion', target: 'sector', kind: 'info', text: () => t.hangar.sector },
  { id: 'hangar-probe', chapter: 'hangar', route: '/incursion', target: 'probe', kind: 'info', text: () => t.hangar.probe },
  { id: 'hangar-relic', chapter: 'hangar', route: '/incursion', target: 'relic-slot', kind: 'action', text: () => t.hangar.relic, advance: { event: 'hangar:relicEquipped' }, skipIf: (o) => !!o?.equipRelic },
  { id: 'hangar-launch', chapter: 'hangar', route: '/incursion', target: 'launch', kind: 'action', text: () => t.hangar.launch, advance: { event: 'run:started' } },

  { id: 'run', chapter: 'run', route: '/incursion', kind: 'action', hidden: true, text: () => t.run.play, advance: { event: 'run:ended' } },

  { id: 'results-loot', chapter: 'results', route: '/incursion', target: 'loot', kind: 'info', text: () => t.results.loot },
  { id: 'results-home', chapter: 'results', route: '/incursion', kind: 'action', text: () => t.results.home, go: { to: '/estacion', label: t.results.toStation }, advance: { route: '/estacion' } },

  { id: 'station-gift', chapter: 'station', route: '/estacion', kind: 'info', text: ({ gift }) => (gift > 0 ? t.station.gift(gift) : t.station.noGift) },
  { id: 'station-resources', chapter: 'station', route: '/estacion', kind: 'info', text: () => t.station.resources },
  { id: 'station-refinery', chapter: 'station', route: '/estacion', target: 'room-refinery', kind: 'info', text: () => t.station.refinery },
  { id: 'station-antenna', chapter: 'station', route: '/estacion', target: 'room-antenna', kind: 'action', text: () => t.station.antenna, advance: { event: 'station:opened:antenna' }, skipIf: (o) => !!o?.repairRoom },
  { id: 'station-repair', chapter: 'station', route: '/estacion', kind: 'action', docked: true, text: () => t.station.repair, advance: { event: 'station:repaired' }, skipIf: (o) => !!o?.repairRoom },
  { id: 'station-bye', chapter: 'station', route: '/estacion', kind: 'info', text: () => t.station.bye },
];

/** Where a chapter happens, for the pill that brings a player back to it. */
export const CHAPTER_ROUTE: Record<TutorialChapter, string> = { hub: '/', scanner: '/escaner', hangar: '/incursion', run: '/incursion', results: '/incursion', station: '/estacion', done: '/' };

/** The steps a player sees counted (the arena's is not a card). */
export const COUNTED = TOUR_STEPS.filter((s) => !s.hidden);
