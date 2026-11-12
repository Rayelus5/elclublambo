import { TIERS, type GalaxySummary, type PulledGalaxy, type Tier } from '@galaxy/shared';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams, useLocation } from 'react-router';
import { useCollectionPages, useFuse, useGacha } from '../api/economy';
import { GalaxyCard } from '../cards/GalaxyCard';
import { useCatalogSummary } from '../api/catalog';
import { copy } from '../copy/es';
import { WalletBar } from '../hub/WalletBar';
import { ClassicStage } from '../scanner/ClassicStage';
import { Icon } from '../ui/Icon';
import { Filters, readFilters, writeFilters, type CollectionFilters } from './Filters';
import { AutoFusionDialog } from './AutoFusionDialog';
import { FuseBar } from './FuseBar';
import { FusionSequence } from './FusionSequence';
import { GalaxyDetailDialog } from './GalaxyDetailDialog';
import { BackLink } from '../ui/BackLink';

// The collection (GDD §8.5): every galaxy the player owns as cards, 30 at a time, filtered and ordered from the URL.
// One toolbar holds the filters and, together, the two ways to fuse (the owner: «muy separados»): «Fusionar» turns
// the cards into toggles to choose `fusion.count` of one tier (legendaries and other tiers cannot be picked), and the
// fusion plays out before its reveal; «Fusión automática» opens its planner. A card opens its detail (/coleccion/:id).
// Favourites wear a star. One polite live region tells what each action did.
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
  const location = useLocation();
  // Arriving from the station's Colisionador, the collection opens ready to fuse (M6d-1).
  const [fusing, setFusing] = useState(() => !!(location.state as { fuse?: boolean } | null)?.fuse);
  const [selected, setSelected] = useState<GalaxySummary[]>([]);
  const [revealed, setRevealed] = useState<PulledGalaxy[] | null>(null);
  // The fusion on screen: the galaxies going in, and the one that came out once the server answers.
  const [melting, setMelting] = useState<GalaxySummary[] | null>(null);
  const [made, setMade] = useState<PulledGalaxy | null>(null);
  const [message, setMessage] = useState('');
  const [auto, setAuto] = useState(false);

  const first = pages.data?.pages[0];
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  const recipe = first?.fusion;
  const count = recipe?.count ?? 5;
  const tier: Tier | undefined = selected[0]?.tier;
  const filtered = !!(filters.tier || filters.type || filters.palette || filters.phenomenon || filters.finish || filters.locked);

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
    !g.equipped && !g.exhibited && !g.listed && !g.traded && !g.locked && g.tier !== 'legendary' && (!tier || g.tier === tier) && (selected.length < count || selected.some((s) => s.id === g.id));

  return (
    <div className="screen-root collection-root">
      <div className="collection">
        <header className="collection-bar">
          <BackLink fallback="/" />
          <h1>{copy.collection.title}</h1>
          {first ? <span className="collection-count">{copy.collection.galaxies(TIERS.reduce((n, t) => n + first.counts[t], 0))}</span> : null}
          <CatalogButton />
          <div className="lip panel hud">
            <WalletBar wallet={gacha.data?.wallet} />
          </div>
        </header>

        <div className="lip panel collection-toolbar">
          <Filters filters={filters} counts={first?.counts} onChange={change} />
          <div className={`fuse-group${fusing ? ' on' : ''}`} role="group" aria-labelledby="fuse-group">
            <span className="fuse-group-title" id="fuse-group">
              {copy.collection.fusionTitle}
            </span>
            <div className="fuse-group-row">
              <button type="button" className={`lip pill ${fusing ? 'fusing' : 'pill-solar'}`} aria-pressed={fusing} onClick={() => (fusing ? stopFusing() : setFusing(true))}>
                <Icon name="fuse" />
                <span>{copy.collection.fuse}</span>
              </button>
              {fusing ? (
                <span className="fuse-group-hint">{copy.collection.fusingHint(count)}</span>
              ) : (
                <button type="button" className="lip pill" onClick={() => setAuto(true)}>
                  <Icon name="cards" />
                  <span>{copy.collection.auto.open}</span>
                </button>
              )}
            </div>
          </div>
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
                      {g.locked ? (
                        <span className="gcard-fav" role="img" aria-label={copy.collection.lockedBadge}>
                          <Icon name="starOn" />
                        </span>
                      ) : null}
                      {g.equipped ? (
                        <span className="gcard-badge">{copy.collection.equipped}</span>
                      ) : g.exhibited ? (
                        <span className="gcard-badge">{copy.planetarium.exhibited}</span>
                      ) : g.listed ? (
                        <span className="gcard-badge">{copy.market.onSale}</span>
                      ) : g.traded ? (
                        <span className="gcard-badge">{copy.trades.inTrade}</span>
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

        {auto ? <AutoFusionDialog filters={filters} count={count} onClose={() => setAuto(false)} onDone={setMessage} /> : null}

        {fusing ? (
          <FuseBar
            selected={selected.length}
            tier={tier}
            recipe={recipe}
            dust={gacha.data?.wallet.dust}
            pending={fuse.isPending}
            error={fuse.error}
            onCancel={stopFusing}
            onFuse={() => {
              setMade(null);
              setMelting(selected);
              fuse.mutate(
                selected.map((s) => s.id),
                {
                  onSuccess: (res) => {
                    stopFusing();
                    setMade(res.galaxy);
                  },
                  onError: () => setMelting(null),
                },
              );
            }}
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
      {melting ? (
        <FusionSequence
          galaxies={melting}
          ready={made !== null}
          onDone={() => {
            setMelting(null);
            if (made) setRevealed([made]);
          }}
        />
      ) : null}
      {revealed ? <ClassicStage pulls={revealed} title={copy.collection.revealTitle} onClose={() => setRevealed(null)} /> : null}
    </div>
  );
}


/** The Catálogo's door: gold and lit, with how many rewards wait, while one is ready to collect. */
function CatalogButton() {
  const ready = useCatalogSummary().data?.ready ?? 0;
  return (
    <Link to="/catalogo" className={ready > 0 ? 'lip pill pill-solar catalog-door ready' : 'lip pill catalog-door'} aria-label={ready > 0 ? copy.catalog.openReady(ready) : undefined}>
      <Icon name="book" />
      <span>{copy.catalog.open}</span>
      {ready > 0 ? (
        <span className="catalog-badge" aria-hidden="true">
          {ready}
        </span>
      ) : null}
    </Link>
  );
}
