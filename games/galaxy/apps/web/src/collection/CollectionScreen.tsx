import type { GalaxySummary, PulledGalaxy, Tier } from '@galaxy/shared';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useCollectionPages, useFuse, useGacha } from '../api/economy';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { WalletBar } from '../hub/WalletBar';
import { RevealStage } from '../scanner/RevealStage';
import { Icon } from '../ui/Icon';
import { Filters, readFilters, writeFilters, type CollectionFilters } from './Filters';
import { FuseBar } from './FuseBar';
import { GalaxyDetailDialog } from './GalaxyDetailDialog';

// The collection (GDD §8.5): every galaxy the player owns as cards, 30 at a time, filtered and ordered from the URL.
// A card opens its detail (/coleccion/:id). «Fusionar» turns the cards into toggles to choose `fusion.count` of one
// tier; legendaries and other tiers cannot be picked. One polite live region tells what each action did.
const PAGE = 30;

export function CollectionScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);
  const search = params.toString() ? `?${params.toString()}` : '';
  const gacha = useGacha();
  const pages = useCollectionPages({ ...filters, limit: PAGE });
  const fuse = useFuse();
  const [fusing, setFusing] = useState(false);
  const [selected, setSelected] = useState<GalaxySummary[]>([]);
  const [revealed, setRevealed] = useState<PulledGalaxy[] | null>(null);
  const [message, setMessage] = useState('');

  const first = pages.data?.pages[0];
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  const recipe = first?.fusion;
  const count = recipe?.count ?? 5;
  const tier: Tier | undefined = selected[0]?.tier;
  const filtered = !!(filters.tier || filters.type || filters.palette || filters.finish);

  function change(next: CollectionFilters): void {
    setSelected([]);
    setParams(writeFilters(next), { replace: true });
  }

  function stopFusing(): void {
    setFusing(false);
    setSelected([]);
    fuse.reset();
  }

  function toggle(g: GalaxySummary): void {
    setSelected((now) => (now.some((s) => s.id === g.id) ? now.filter((s) => s.id !== g.id) : [...now, g]));
  }

  const pickable = (g: GalaxySummary) =>
    !g.equipped && !g.exhibited && !g.listed && g.tier !== 'legendary' && (!tier || g.tier === tier) && (selected.length < count || selected.some((s) => s.id === g.id));

  return (
    <div className="screen-root collection-root">
      <div className="collection">
        <header className="collection-bar">
          <Link to="/" className="lip pill">
            <Icon name="back" />
            <span>{copy.collection.back}</span>
          </Link>
          <h1>{copy.collection.title}</h1>
          <div className="lip panel hud">
            <WalletBar wallet={gacha.data?.wallet} />
          </div>
        </header>

        <div className="collection-tools">
          <Filters filters={filters} counts={first?.counts} onChange={change} />
          <button type="button" className={`lip pill ${fusing ? '' : 'pill-solar'}`} aria-pressed={fusing} onClick={() => (fusing ? stopFusing() : setFusing(true))}>
            <Icon name="fuse" />
            <span>{fusing ? copy.collection.cancel : copy.collection.fuse}</span>
          </button>
        </div>

        <main className="collection-main" aria-busy={pages.isPending || pages.isFetchingNextPage || undefined}>
          {pages.isPending ? (
            <p className="collection-wait" aria-hidden="true">
              ⠋⠙⠹
            </p>
          ) : items.length === 0 ? (
            <div className="collection-empty">
              <p>{filtered ? copy.collection.emptyFiltered : copy.collection.empty}</p>
              {filtered ? null : (
                <Link to="/escaner" className="lip pill pill-solar">
                  <Icon name="radar" />
                  <span>{copy.collection.scanNow}</span>
                </Link>
              )}
            </div>
          ) : (
            <ul className="card-grid">
              {items.map((g) => {
                const on = selected.some((s) => s.id === g.id);
                return (
                  <li key={g.id} className={on ? 'picked' : undefined}>
                    <GalaxyCard galaxy={g} size={200} interactive>
                      {g.equipped ? (
                        <span className="gcard-badge">{copy.collection.equipped}</span>
                      ) : g.exhibited ? (
                        <span className="gcard-badge">{copy.planetarium.exhibited}</span>
                      ) : g.listed ? (
                        <span className="gcard-badge">{copy.market.onSale}</span>
                      ) : null}
                      {fusing ? (
                        <button type="button" className="gcard-hit" aria-pressed={on} aria-label={copy.collection.select(g.name)} disabled={!pickable(g)} onClick={() => toggle(g)}>
                          {on ? <Icon name="check" className="ico gcard-check" /> : null}
                        </button>
                      ) : (
                        <Link className="gcard-hit" to={`/coleccion/${g.id}${search}`} aria-label={copy.collection.open(g.name)} />
                      )}
                    </GalaxyCard>
                  </li>
                );
              })}
            </ul>
          )}
          {pages.hasNextPage ? (
            <button type="button" className="lip pill more-cards" disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
              {copy.collection.loadMore}
            </button>
          ) : null}
        </main>

        {fusing ? (
          <FuseBar
            selected={selected.length}
            tier={tier}
            recipe={recipe}
            dust={gacha.data?.wallet.dust}
            pending={fuse.isPending}
            error={fuse.error}
            onCancel={stopFusing}
            onFuse={() =>
              fuse.mutate(
                selected.map((s) => s.id),
                {
                  onSuccess: (res) => {
                    stopFusing();
                    setRevealed([res.galaxy]);
                  },
                },
              )
            }
          />
        ) : null}

        <p className="toast" role="status">
          {message}
        </p>
      </div>

      {id ? (
        <GalaxyDetailDialog
          key={id}
          id={id}
          onClose={() => navigate(`/coleccion${search}`)}
          onDisintegrated={(name, dust) => {
            setMessage(copy.collection.disintegrated(name, dust));
            navigate(`/coleccion${search}`, { replace: true });
          }}
        />
      ) : null}
      {revealed ? <RevealStage pulls={revealed} title={copy.collection.revealTitle} onClose={() => setRevealed(null)} /> : null}
    </div>
  );
}

