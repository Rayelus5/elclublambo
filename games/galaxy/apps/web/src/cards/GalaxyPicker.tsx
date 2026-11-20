import { TIERS, type GalaxySummary, type Tier } from '@galaxy/shared';
import { useState } from 'react';
import { useCollectionPages } from '../api/economy';
import { FilterSelect, phenomenonOptions } from '../collection/Filters';
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
  filters = false,
  blockedFor,
}: {
  text: GalaxyPickerCopy;
  taken: ReadonlySet<string>;
  /** Galaxies that cannot be picked for their own state (equipped, exhibited, for sale). */
  isTaken?: (g: GalaxySummary) => boolean;
  /** A galaxy that cannot be picked here for a reason of its own (a mythic in the market): the badge says it. */
  blockedFor?: (g: GalaxySummary) => string | null;
  onPick: (g: GalaxySummary) => void;
  onClose: () => void;
  className: string;
  /** A bar to filter by phenomenon and rarity (the relic picker: plan «escáner pro», part D). */
  filters?: boolean;
}) {
  const [phenomenon, setPhenomenon] = useState<string | undefined>();
  const [tier, setTier] = useState<Tier | undefined>();
  const pages = useCollectionPages({ sort: 'rarity', limit: 30, ...(phenomenon ? { phenomenon } : {}), ...(tier ? { tier } : {}) });
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Dialog title={text.title} onClose={onClose} className={className}>
      {filters ? (
        <div className="filters-row picker-filters">
          <FilterSelect label={copy.traitNames['phenomenon']!} value={phenomenon} options={phenomenonOptions()} onChange={setPhenomenon} />
          <FilterSelect label={copy.collection.tierLabel} value={tier} options={[...TIERS].reverse().map((t): [string, string] => [t, copy.tiers[t]])} onChange={(v) => setTier(v as Tier | undefined)} />
        </div>
      ) : null}
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
            const blocked = busy ? null : (blockedFor?.(g) ?? null);
            return (
              <li key={g.id}>
                <GalaxyCard galaxy={g} size={150}>
                  <button type="button" className="gcard-hit" aria-label={text.pick(g.name)} disabled={busy || blocked !== null} onClick={() => onPick(g)} />
                </GalaxyCard>
                {busy && <span className="relic-taken">{text.taken}</span>}
                {blocked !== null && <span className="relic-taken">{blocked}</span>}
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
