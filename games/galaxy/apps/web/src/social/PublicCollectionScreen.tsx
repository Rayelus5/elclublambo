import { type Tier, TIERS } from '@galaxy/shared';
import { useState } from 'react';
import { useParams } from 'react-router';
import { ApiError } from '../api/client';
import { usePublicCollection } from '../api/social';
import { errorText } from '../auth/useMe';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy, fmt } from '../copy/es';
import { Icon } from '../ui/Icon';
import { BackLink } from '../ui/BackLink';

// A player's collection as anyone may see it (GDD §14.2; DESIGN_SYSTEM §8 undecies): their cards by rarity, without
// any action, filtered by rarity and paged like one's own.

const t = copy.social;

export function PublicCollectionScreen() {
  const { username = '' } = useParams();
  const [tier, setTier] = useState<Tier | undefined>(undefined);
  const pages = usePublicCollection(username, tier);
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  const counts = pages.data?.pages[0]?.counts;
  const missing = pages.error instanceof ApiError && (pages.error.status === 404 || pages.error.status === 400);
  const title = t.collectionOf(username);
  return (
    <div className="screen-root collection-root">
      <div className="collection">
        <header className="collection-bar">
          <BackLink fallback={`/perfil/${encodeURIComponent(username)}`}>
            <Icon name="back" />
            <span>{t.backToProfile}</span>
          </BackLink>
          <h1>{title}</h1>
        </header>
        {missing ? (
          <div className="lip panel lb-empty">
            <p>{copy.errors.profile_not_found}</p>
          </div>
        ) : pages.error ? (
          <p className="field-error" role="alert">
            {errorText(pages.error, copy.errors)}
          </p>
        ) : null}
        <div className="chips" role="group" aria-label={copy.hub.byTier}>
          <button type="button" className="chip" aria-pressed={tier === undefined} onClick={() => setTier(undefined)}>
            {t.allTiers}
          </button>
          {[...TIERS].reverse().map((k) => (
            <button key={k} type="button" className="chip" data-tier={k} aria-pressed={tier === k} onClick={() => setTier(k)}>
              <i aria-hidden="true" />
              {copy.tiers[k]}
              {counts ? <small>{fmt(counts[k])}</small> : null}
            </button>
          ))}
        </div>
        <main className="collection-main" aria-busy={pages.isPending || pages.isFetchingNextPage || undefined}>
          {pages.isPending ? (
            <p className="collection-wait" aria-hidden="true">
              ⠋⠙⠹
            </p>
          ) : items.length === 0 && !missing ? (
            <div className="collection-empty">
              <p>{t.emptyCollection}</p>
            </div>
          ) : (
            <ul className="card-grid" aria-label={title}>
              {items.map((g) => (
                <li key={g.id}>
                  <GalaxyCard galaxy={g} size={200} interactive />
                </li>
              ))}
            </ul>
          )}
          {pages.hasNextPage ? (
            <button type="button" className="lip pill more-cards" disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
              {copy.collection.loadMore}
            </button>
          ) : null}
        </main>
      </div>
    </div>
  );
}
