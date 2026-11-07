import type { GalaxySummary } from '@galaxy/shared';
import { useCollectionPages } from '../api/economy';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';

// Choosing a galaxy for a relic slot (GDD §8.4): the collection by rarity; galaxies already in another slot show as
// equipped and cannot be picked twice.

export function RelicPicker({ taken, onPick, onClose }: { taken: ReadonlySet<string>; onPick: (g: GalaxySummary) => void; onClose: () => void }) {
  const pages = useCollectionPages({ sort: 'rarity', limit: 30 });
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Dialog title={copy.hangar.pickerTitle} onClose={onClose} className="relic-picker">
      {pages.isPending ? (
        <p className="spinner" role="status" aria-label={copy.loading}>
          ⠋⠙⠹
        </p>
      ) : items.length === 0 ? (
        <p>{copy.hangar.pickerEmpty}</p>
      ) : (
        <ul className="relic-grid">
          {items.map((g) => {
            const busy = taken.has(g.id);
            return (
              <li key={g.id}>
                <GalaxyCard galaxy={g} size={150}>
                  <button type="button" className="gcard-hit" aria-label={copy.hangar.equip(g.name)} disabled={busy} onClick={() => onPick(g)} />
                </GalaxyCard>
                {busy && <span className="relic-taken">{copy.collection.equipped}</span>}
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
