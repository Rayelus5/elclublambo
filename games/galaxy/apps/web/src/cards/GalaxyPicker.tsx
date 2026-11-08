import type { GalaxySummary } from '@galaxy/shared';
import { useCollectionPages } from '../api/economy';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { GalaxyCard } from './GalaxyCard';

// Choosing one of the player's galaxies for a place (a relic slot, a pedestal): the collection by rarity; the ones
// already in another place show why and cannot be picked twice.

export interface GalaxyPickerCopy {
  title: string;
  empty: string;
  pick: (name: string) => string;
  /** The badge of a galaxy already in another place. */
  taken: string;
}

export function GalaxyPicker({
  text,
  taken,
  isTaken,
  onPick,
  onClose,
  className,
}: {
  text: GalaxyPickerCopy;
  taken: ReadonlySet<string>;
  /** Galaxies that cannot be picked for their own state (equipped, exhibited, for sale). */
  isTaken?: (g: GalaxySummary) => boolean;
  onPick: (g: GalaxySummary) => void;
  onClose: () => void;
  className: string;
}) {
  const pages = useCollectionPages({ sort: 'rarity', limit: 30 });
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Dialog title={text.title} onClose={onClose} className={className}>
      {pages.isPending ? (
        <p className="spinner" role="status" aria-label={copy.loading}>
          ⠋⠙⠹
        </p>
      ) : items.length === 0 ? (
        <p>{text.empty}</p>
      ) : (
        <ul className="relic-grid">
          {items.map((g) => {
            const busy = taken.has(g.id) || isTaken?.(g) === true;
            return (
              <li key={g.id}>
                <GalaxyCard galaxy={g} size={150}>
                  <button type="button" className="gcard-hit" aria-label={text.pick(g.name)} disabled={busy} onClick={() => onPick(g)} />
                </GalaxyCard>
                {busy && <span className="relic-taken">{text.taken}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {pages.hasNextPage && (
        <button type="button" className="lip pill more-cards" disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
          {copy.collection.loadMore}
        </button>
      )}
    </Dialog>
  );
}
