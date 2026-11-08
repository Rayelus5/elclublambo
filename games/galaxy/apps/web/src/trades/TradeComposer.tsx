import type { GalaxySummary, PublicGalaxy, TradeView } from '@galaxy/shared';
import { useState } from 'react';
import { useChangeTrade, useProposeTrade } from '../api/trades';
import { usePublicCollection } from '../api/social';
import { errorText } from '../auth/useMe';
import { GalaxyCard } from '../cards/GalaxyCard';
import { GalaxyPicker } from '../cards/GalaxyPicker';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';

const t = copy.trades;
const day = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(new Date(iso));
/** A galaxy already held somewhere else (equipped, exhibited, for sale or in another trade). */
const heldElsewhere = (g: GalaxySummary, current: string | null) => g.id !== current && (g.equipped === true || g.exhibited === true || g.listed === true || g.traded === true);

/** One of the other player's galaxies, from their public collection. */
function TheirPicker({ username, onPick, onClose }: { username: string; onPick: (g: PublicGalaxy) => void; onClose: () => void }) {
  const pages = usePublicCollection(username, undefined);
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Dialog title={t.pickTheirs(username)} onClose={onClose} className="relic-picker">
      {pages.isPending ? (
        <p className="spinner" role="status" aria-label={copy.loading}>
          ⠋⠙⠹
        </p>
      ) : items.length === 0 ? (
        <p>{t.theirsEmpty(username)}</p>
      ) : (
        <ul className="relic-grid">
          {items.map((g) => (
            <li key={g.id}>
              <GalaxyCard galaxy={g} size={150}>
                <button type="button" className="gcard-hit" aria-label={t.askOne(g.name)} onClick={() => onPick(g)} />
              </GalaxyCard>
            </li>
          ))}
        </ul>
      )}
      {pages.hasNextPage ? (
        <button type="button" className="lip pill more-cards" disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
          {copy.collection.loadMore}
        </button>
      ) : null}
    </Dialog>
  );
}

type Slot = PublicGalaxy | GalaxySummary | null;

/**
 * Composing a swap (DESIGN_SYSTEM §8 quindecies): «Doy» (one of mine that is free) and «Quiero» (one of theirs). New, it
 * proposes; over an open trade, it changes it naming the version seen. What I give is reserved until the trade closes.
 */
export function TradeComposer({
  username,
  trade,
  days,
  onDone,
  onClose,
}: {
  username: string;
  /** The trade being changed, or none to propose a new one. */
  trade?: TradeView;
  days: number;
  onDone: (v: TradeView) => void;
  onClose: () => void;
}) {
  const [give, setGive] = useState<Slot>(trade?.me.galaxy ?? null);
  const [want, setWant] = useState<Slot>(trade?.them.galaxy ?? null);
  // The version and the deal as they were when this opened: a newer version that arrives meanwhile is answered with
  // trade_changed instead of being overwritten (M5c-2 review).
  const [seen] = useState(() => (trade ? { version: trade.version, give: trade.me.galaxy?.id ?? null, want: trade.them.galaxy?.id ?? null, until: trade.expiresAt } : null));
  const unchanged = seen !== null && (give?.id ?? null) === seen.give && (want?.id ?? null) === seen.want;
  const [picking, setPicking] = useState<'mine' | 'theirs' | null>(null);
  const propose = useProposeTrade();
  const change = useChangeTrade();
  const busy = propose.isPending || change.isPending;
  const error = propose.error ?? change.error;
  const current = trade?.me.galaxy?.id ?? null;

  function submit(): void {
    if (!give) return;
    if (trade && seen) change.mutate({ id: trade.id, give: give.id, want: want?.id ?? null, version: seen.version }, { onSuccess: onDone });
    else propose.mutate({ username, give: give.id, ...(want ? { want: want.id } : {}) }, { onSuccess: onDone });
  }

  const slot = (label: string, g: Slot, choose: string, open: () => void) => (
    <section className="trade-slot" aria-label={label}>
      <h3>{label}</h3>
      {g ? <GalaxyCard galaxy={g} size={170} /> : <div className="trade-empty">{t.nothing}</div>}
      <button type="button" className="lip pill small" onClick={open}>
        {choose}
      </button>
    </section>
  );

  return (
    <Dialog title={trade ? t.changeTitle(username) : t.proposeTitle(username)} onClose={onClose} className="trade-composer">
      <div className="trade-sides">
        {slot(t.give, give, t.chooseMine, () => setPicking('mine'))}
        <span className="trade-arrows" aria-hidden="true" />
        {slot(t.want, want, t.chooseTheirs, () => setPicking('theirs'))}
      </div>
      <p className="panel-note">{seen ? t.heldUntil(day(seen.until)) : t.held(days)}</p>
      {error ? (
        <p className="field-error" role="alert">
          {errorText(error, copy.errors)}
        </p>
      ) : null}
      <div className="confirm-actions">
        <button type="button" className="lip pill" onClick={onClose}>
          {t.keep}
        </button>
        <button type="button" className="lip pill pill-solar" disabled={!give || busy || unchanged} aria-busy={busy || undefined} onClick={submit}>
          {trade ? t.save : t.send}
        </button>
      </div>
      {picking === 'mine' ? (
        <GalaxyPicker
          text={{ title: t.pickMine, empty: t.mineEmpty, pick: t.giveOne, taken: t.unavailable }}
          taken={new Set()}
          isTaken={(g) => heldElsewhere(g, current)}
          onPick={(g) => {
            setGive(g);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
          className="relic-picker"
        />
      ) : picking === 'theirs' ? (
        <TheirPicker
          username={username}
          onPick={(g) => {
            setWant(g);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </Dialog>
  );
}
