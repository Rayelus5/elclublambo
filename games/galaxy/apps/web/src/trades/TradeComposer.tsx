import { commissionOf, type GalaxySummary, type MyTrades, type PublicGalaxy, type TradeDealInput, type TradePostView, type TradeView } from '@galaxy/shared';
import { useId, useState } from 'react';
import { useGacha } from '../api/economy';
import { useChangeTrade, useProposeTrade } from '../api/trades';
import { usePublicCollection } from '../api/social';
import { errorText } from '../auth/useMe';
import { GalaxyCard } from '../cards/GalaxyCard';
import { GalaxyPicker } from '../cards/GalaxyPicker';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { Wants } from './PostWants';

const t = copy.trades;
const day = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(new Date(iso));
/** A galaxy already held somewhere else (equipped, exhibited, for sale or in another trade). */
const heldElsewhere = (g: GalaxySummary, current: string[]) => !current.includes(g.id) && (g.equipped === true || g.exhibited === true || g.listed === true || g.traded === true);

/** One of the other player's galaxies, from their public collection; the ones already asked for, out. */
function TheirPicker({ username, chosen, onPick, onClose }: { username: string; chosen: string[]; onPick: (g: PublicGalaxy) => void; onClose: () => void }) {
  const pages = usePublicCollection(username, undefined);
  const items = (pages.data?.pages.flatMap((p) => p.items) ?? []).filter((g) => !chosen.includes(g.id));
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

type Card = PublicGalaxy | GalaxySummary;
type Chosen = { galaxies: Card[]; coins: string };
const coinsOf = (p: Chosen) => (/^\d{1,10}$/.test(p.coins.trim()) ? Number(p.coins.trim()) : p.coins.trim() === '' ? 0 : NaN);
const toDeal = (p: Chosen): TradeDealInput => ({ galaxies: p.galaxies.map((g) => g.id), coins: coinsOf(p) || 0 });
const sameDeal = (x: TradeDealInput, y: TradeDealInput) => x.coins === y.coins && x.galaxies.length === y.galaxies.length && x.galaxies.every((g) => y.galaxies.includes(g));

/**
 * Composing a swap (DESIGN_SYSTEM §8 quindecies; trades 2.0, 2026-11-14): «Doy» (mine that are free) and «Quiero»
 * (theirs), up to `tradeGalaxies` galaxies a side, and coins on one side at most. New, it proposes; over an open trade
 * it sends a counter-offer naming the version seen. What I give, coins included, is held until the trade closes.
 */
export function TradeComposer({
  username,
  trade,
  post,
  rules,
  onDone,
  onClose,
}: {
  username: string;
  /** The trade being countered, or none to propose a new one. */
  trade?: TradeView;
  /** The board post this answers (2026-11-14): what it gives is what I want, fixed. */
  post?: TradePostView;
  rules: Pick<MyTrades['rules'], 'tradeDays' | 'tradeGalaxies' | 'commission'>;
  onDone: (v: TradeView) => void;
  onClose: () => void;
}) {
  const ids = useId();
  const coins = useGacha().data?.wallet.coins;
  const [give, setGive] = useState<Chosen>({ galaxies: trade?.me.galaxies ?? [], coins: trade?.me.coins ? String(trade.me.coins) : '' });
  const [want, setWant] = useState<Chosen>(
    post ? { galaxies: post.galaxies, coins: post.coins ? String(post.coins) : '' } : { galaxies: trade?.them.galaxies ?? [], coins: trade?.them.coins ? String(trade.them.coins) : '' },
  );
  const fixed = post !== undefined;
  // The version and the deal as they were when this opened: a newer version that arrives meanwhile is answered with
  // trade_changed instead of being overwritten (M5c-2 review).
  const [seen] = useState(() => (trade ? { version: trade.version, give: toDeal({ galaxies: trade.me.galaxies, coins: String(trade.me.coins) }), want: toDeal({ galaxies: trade.them.galaxies, coins: String(trade.them.coins) }), until: trade.expiresAt } : null));
  const [picking, setPicking] = useState<'mine' | 'theirs' | null>(null);
  const propose = useProposeTrade();
  const change = useChangeTrade();
  const busy = propose.isPending || change.isPending;
  const error = propose.error ?? change.error;
  const [g, w] = [coinsOf(give), coinsOf(want)];
  const coinsOk = Number.isFinite(g) && Number.isFinite(w) && !(g > 0 && w > 0);
  const short = coins !== undefined && g > coins && (!seen || g !== seen.give.coins) ? g - coins : 0;
  const unchanged = seen !== null && sameDeal(toDeal(give), seen.give) && sameDeal(toDeal(want), seen.want);
  const givesSomething = give.galaxies.length > 0 || g > 0;
  const canSend = coinsOk && short === 0 && !unchanged && !busy && (trade ? true : givesSomething);
  const max = rules.tradeGalaxies;
  const current = (trade?.me.galaxies ?? []).map((x) => x.id);

  function submit(): void {
    const d = { give: toDeal(give), want: toDeal(want) };
    if (trade && seen) change.mutate({ id: trade.id, ...d, version: seen.version }, { onSuccess: onDone });
    else propose.mutate({ username, ...d, ...(post ? { post: post.id } : {}) }, { onSuccess: onDone });
  }

  const column = (side: 'give' | 'want') => {
    const p = side === 'give' ? give : want;
    const set = side === 'give' ? setGive : setWant;
    const otherCoins = side === 'give' ? w : g;
    const label = side === 'give' ? t.give : t.want;
    // Answering a post: what it gives is fixed.
    const locked = fixed && side === 'want';
    return (
      <section className="trade-slot trade-column" aria-label={label}>
        <h3>{label}</h3>
        <ul className={`trade-cards n${p.galaxies.length}`}>
          {p.galaxies.map((x) => (
            <li key={x.id}>
              <GalaxyCard galaxy={x} size={p.galaxies.length > 1 ? 120 : 160} />
              {locked ? null : (
                <button type="button" className="lip pill small trade-remove" aria-label={t.remove(x.name)} onClick={() => set({ ...p, galaxies: p.galaxies.filter((y) => y.id !== x.id) })}>
                  <Icon name="close" />
                </button>
              )}
            </li>
          ))}
          {p.galaxies.length === 0 ? (
            <li>
              <div className="trade-empty">{t.nothing}</div>
            </li>
          ) : null}
        </ul>
        {locked ? (
          <p className="panel-note">{copy.trades.board.fixed}</p>
        ) : p.galaxies.length < max ? (
          <button type="button" className="lip pill small" aria-haspopup="dialog" onClick={() => setPicking(side === 'give' ? 'mine' : 'theirs')}>
            <Icon name="plus" />
            <span>{side === 'give' ? t.chooseMine : t.chooseTheirs}</span>
          </button>
        ) : (
          <p className="panel-note">{t.upTo(max)}</p>
        )}
        <div className="field trade-coins">
          <label htmlFor={`${ids}-${side}`}>{side === 'give' ? t.giveCoins : t.wantCoins}</label>
          <div className="control">
            <input
              id={`${ids}-${side}`}
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="0"
              value={p.coins}
              disabled={otherCoins > 0 || locked}
              aria-describedby={`${ids}-${side}-hint`}
              aria-invalid={!Number.isFinite(coinsOf(p)) || undefined}
              onChange={(e) => set({ ...p, coins: e.target.value })}
            />
          </div>
          <p className="hint" id={`${ids}-${side}-hint`}>
            {otherCoins > 0
              ? t.coinsOneSide
              : side === 'give' && g > 0
                ? short > 0
                  ? copy.market.missing(short)
                  : t.coinsHeld
                : side === 'want' && w > 0
                  ? t.net(w - commissionOf(w, rules.commission))
                  : t.coinsOneSide}
          </p>
        </div>
      </section>
    );
  };

  return (
    <Dialog title={post ? copy.trades.board.answerTitle(username) : trade ? t.changeTitle(username) : t.proposeTitle(username)} onClose={onClose} className="trade-composer">
      {post ? (
        <div className="post-answer-seeks">
          <span>{copy.trades.board.seeks}</span>
          <Wants w={post.wants} />
          {post.note ? <blockquote className="post-note">{post.note}</blockquote> : null}
        </div>
      ) : null}
      <div className="trade-sides">
        {column('give')}
        <span className="trade-arrows" aria-hidden="true" />
        {column('want')}
      </div>
      <p className="panel-note">
        {t.upTo(max)} · {seen ? t.heldUntil(day(seen.until)) : t.held(rules.tradeDays)}
      </p>
      {error ? (
        <p className="field-error" role="alert">
          {errorText(error, copy.errors)}
        </p>
      ) : null}
      <div className="confirm-actions">
        <button type="button" className="lip pill" onClick={onClose}>
          {t.keep}
        </button>
        <button type="button" className="lip pill pill-solar" disabled={!canSend} aria-busy={busy || undefined} onClick={submit}>
          {post ? copy.trades.board.answerSend : trade ? t.save : t.send}
        </button>
      </div>
      {picking === 'mine' ? (
        <GalaxyPicker
          text={{ title: t.pickMine, empty: t.mineEmpty, pick: t.giveOne, taken: t.unavailable }}
          taken={new Set(give.galaxies.map((x) => x.id))}
          isTaken={(x) => heldElsewhere(x, current)}
          onPick={(x) => {
            setGive((p) => ({ ...p, galaxies: [...p.galaxies, x].slice(0, max) }));
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
          className="relic-picker"
        />
      ) : picking === 'theirs' ? (
        <TheirPicker
          username={username}
          chosen={want.galaxies.map((x) => x.id)}
          onPick={(x) => {
            setWant((p) => ({ ...p, galaxies: [...p.galaxies, x].slice(0, max) }));
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </Dialog>
  );
}
