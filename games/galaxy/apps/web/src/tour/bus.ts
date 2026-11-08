// The tour's events (polish phase 3): screens say what the player just did in one line (emitTour), and the tour
// moves on when the step it waits for hears its event. Nothing listens outside the tour.

export type TourEvent =
  | 'scanner:pulled'
  | 'scanner:revealClosed'
  | 'hangar:relicEquipped'
  | 'run:started'
  | 'run:ended'
  | 'station:opened:antenna'
  | 'station:opened:refinery'
  | 'station:repaired';

const bus = new EventTarget();

export function emitTour(name: TourEvent): void {
  bus.dispatchEvent(new CustomEvent('tour', { detail: name }));
}

export function onTour(fn: (name: TourEvent) => void): () => void {
  const listener = (e: Event) => fn((e as CustomEvent<TourEvent>).detail);
  bus.addEventListener('tour', listener);
  return () => bus.removeEventListener('tour', listener);
}
