import { atLeast, DISINTEGRATE_MAX, TIERS, type GalaxySummary, type PulledGalaxy, type Tier } from '@galaxy/shared';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams, useLocation } from 'react-router';
import { previewDisintegrate, useCollectionPages, useDisintegrateMany, useFuse, useGacha } from '../api/economy';
import { errorText } from '../auth/useMe';
import { Dialog } from '../ui/Dialog';
import { useReducedMotion } from '../ui/motion';
import { DisintegrateFx } from './DisintegrateFx';
import { DissolveBar } from './DissolveBar';
import { GalaxyCard } from '../cards/GalaxyCard';
import { useCatalogSummary } from '../api/catalog';
import { copy } from '../copy/es';
import { WalletBar } from '../hub/WalletBar';
import { ClassicStage } from '../scanner/ClassicStage';
import { RevealStage } from '../scanner/RevealStage';
import { useRevealMode } from '../scanner/useRevealMode';
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
// Favourites wear a star. One polite live region tells what each action did. With «Presentación pro» (plan «fusión
// pro»), the fusion is the scanner's cinema instead: the bands close at «Fusionar», the galaxies going in circle and
// sink into a core, and the new one bursts out of it; a failed fusion opens the bands and the bar says why.
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
  // The pro fusion: the galaxies going in, the new one once the server answers (null until then), and a failure.
  const revealMode = useRevealMode();
  const [cinema, setCinema] = useState<{ inputs: GalaxySummary[]; pulls: PulledGalaxy[] | null; failed: boolean } | null>(null);
  const [message, setMessage] = useState('');
  const [auto, setAuto] = useState(false);
  // Desintegrar varias (the owner): the chosen ones go together, after a confirmation with the dust the server counts.
  const [dissolving, setDissolving] = useState(false);
  const dissolve = useDisintegrateMany();
  const [asking, setAsking] = useState<{ count: number; dust: number } | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [previewing, setPreviewing] = useState(false);
  // The galaxies coming apart on screen (one from the detail, or several), with the dust they gave.
  const [fx, setFx] = useState<{ galaxies: PulledGalaxy[]; dust: number } | null>(null);
  const reduced = useReducedMotion();

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

  function stopDissolving(): void {
    setDissolving(false);
    setSelected([]);
    setAsking(null);
    setPreviewError(null);
    dissolve.reset();
  }

  function askDissolve(): void {
    setPreviewError(null);
    setPreviewing(true);
    previewDisintegrate(selected.map((s) => s.id))
      .then((p) => setAsking(p))
      .catch((e: unknown) => setPreviewError(e))
      .finally(() => setPreviewing(false));
  }

  function confirmDissolve(): void {
    const going = selected;
    dissolve.mutate(
      going.map((s) => s.id),
      {
        onSuccess: (res) => {
          stopDissolving();
          setFx({ galaxies: going, dust: res.dust });
          setMessage(copy.collection.dissolved(res.count, res.dust));
        },
      },
    );
  }

  function toggle(g: GalaxySummary): void {
    setSelected((now) => (now.some((s) => s.id === g.id) ? now.filter((s) => s.id !== g.id) : [...now, g]));
  }

  const held = (g: GalaxySummary) => !!(g.equipped || g.exhibited || g.listed || g.traded || g.locked);
  const pickable = (g: GalaxySummary) =>
    dissolving
      ? !held(g) && (selected.length < DISINTEGRATE_MAX || selected.some((s) => s.id === g.id))
      : !held(g) && !atLeast(g.tier, 'legendary') && (!tier || g.tier === tier) && (selected.length < count || selected.some((s) => s.id === g.id));
  // The epic-or-better ones about to go, named in the confirmation.
  const best = selected.filter((g) => atLeast(g.tier, 'epic')).map((g) => g.name);

  return (
    <div className="screen-root collection-root">
      <div className="collection">
        <header className="collection-bar">
          <BackLink fallback="/" />
          <h1>{copy.collection.title}</h1>
          {first ? <span className="collection-count">{copy.collection.galaxies(TIERS.reduce((n, t) => n + (first.counts[t] ?? 0), 0))}</span> : null}
          <CatalogButton />
          <div className="lip panel hud">
            <WalletBar wallet={gacha.data?.wallet} />
          </div>
        </header>

        <div className="lip panel collection-toolbar">
          <Filters filters={filters} counts={first?.counts} onChange={change} />
          <div className="collection-tools">
          <div className={`fuse-group${fusing ? ' on' : ''}`} role="group" aria-labelledby="fuse-group">
            <span className="fuse-group-title" id="fuse-group">
              {copy.collection.fusionTitle}
            </span>
            <div className="fuse-group-row">
              <button
                type="button"
                className={`lip pill ${fusing ? 'fusing' : 'pill-solar'}`}
                aria-pressed={fusing}
                onClick={() => {
                  if (fusing) return stopFusing();
                  stopDissolving();
                  setFusing(true);
                }}
              >
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
          <div className={`fuse-group${dissolving ? ' on' : ''}`} role="group" aria-labelledby="dissolve-group">
            <span className="fuse-group-title" id="dissolve-group">
              {copy.collection.dissolveGroup}
            </span>
            <div className="fuse-group-row">
              <button
                type="button"
                className={`lip pill${dissolving ? ' fusing' : ''}`}
                aria-pressed={dissolving}
                onClick={() => {
                  if (dissolving) return stopDissolving();
                  stopFusing();
                  setDissolving(true);
                }}
              >
                <Icon name="dust" />
                <span>{copy.collection.dissolveMany}</span>
              </button>
              {dissolving ? <span className="fuse-group-hint">{copy.collection.dissolvingHint(DISINTEGRATE_MAX)}</span> : null}
            </div>
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
                      {fusing || dissolving ? (
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
              if (revealMode === 'pro') {
                setCinema({ inputs: selected, pulls: null, failed: false });
                fuse.mutate(
                  selected.map((s) => s.id),
                  {
                    onSuccess: (res) => {
                      stopFusing();
                      setCinema((c) => (c ? { ...c, pulls: [res.galaxy] } : c));
                    },
                    onError: () => setCinema((c) => (c ? { ...c, failed: true } : c)),
                  },
                );
                return;
              }
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

        {dissolving ? <DissolveBar selected={selected} pending={previewing || dissolve.isPending} error={previewError} onCancel={stopDissolving} onDissolve={askDissolve} /> : null}
        {asking ? (
          <Dialog role="alertdialog" title={copy.collection.dissolveTitle(asking.count)} onClose={() => setAsking(null)} className="confirm">
            <p>{copy.collection.disintegrateManyBody(asking.dust)}</p>
            {best.length > 0 ? <p className="dissolve-best">{copy.collection.dissolveBest(best)}</p> : null}
            {dissolve.isError ? (
              <p className="summary error" role="alert">
                <Icon name="alert" />
                <span>{errorText(dissolve.error, copy.errors)}</span>
              </p>
            ) : null}
            <div className="confirm-actions">
              <button type="button" className="lip pill" data-autofocus onClick={() => setAsking(null)}>
                {copy.collection.cancel}
              </button>
              <button type="button" className="lip pill danger" disabled={dissolve.isPending} aria-busy={dissolve.isPending || undefined} onClick={confirmDissolve}>
                {copy.collection.disintegrate}
              </button>
            </div>
          </Dialog>
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
          onDisintegrated={(galaxy, dust) => {
            setFx({ galaxies: [galaxy], dust });
            setMessage(copy.collection.disintegrated(galaxy.name, dust));
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
      {fx ? <DisintegrateFx galaxies={fx.galaxies} dust={fx.dust} reduced={reduced} onDone={() => setFx(null)} /> : null}
      {revealed ? <ClassicStage pulls={revealed} title={copy.collection.revealTitle} onClose={() => setRevealed(null)} /> : null}
      {cinema ? (
        <RevealStage
          pulls={cinema.pulls}
          title={copy.collection.revealTitle}
          intro="fusion"
          inputs={cinema.inputs}
          failed={cinema.failed}
          onAbort={() => setCinema(null)}
          onClose={() => setCinema(null)}
        />
      ) : null}
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
