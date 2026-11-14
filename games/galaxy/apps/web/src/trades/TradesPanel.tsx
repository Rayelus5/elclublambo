import { commissionOf, type MyTrades, type TradeEvent, type TradeSide, type TradeView } from '@galaxy/shared';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { useCancelTrade, useConfirmTrade } from '../api/trades';
import { errorText } from '../auth/useMe';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { TradeComposer } from './TradeComposer';

const t = copy.trades;
const day = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(new Date(iso));
const when = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const list = new Intl.ListFormat('es', { type: 'conjunction' });
const givesSomething = (s: { galaxies: readonly unknown[]; coins: number }) => s.galaxies.length > 0 || s.coins > 0;

/** What a side gives, in words: «Vega, Orión y 500 monedas», or «nada». */
export function dealText(s: { galaxies: readonly { name: string }[]; coins: number }): string {
  const parts = [...s.galaxies.map((g) => g.name), ...(s.coins > 0 ? [t.coinsChip(s.coins)] : [])];
  return parts.length ? list.format(parts) : t.dealNothing;
}

/** Whose turn it is, said plainly. */
function stateOf(v: TradeView): string {
  if (!givesSomething(v.me) || !givesSomething(v.them)) return t.incomplete;
  if (v.me.confirmed && !v.them.confirmed) return t.waiting(v.them.username);
  if (!v.me.confirmed && v.them.confirmed) return t.theyConfirmed(v.them.username);
  return t.review;
}

/** One side of an open trade: its cards (smaller when several) and its coins; the coins I get, after the commission. */
function SideView({ label, s, commission, getting }: { label: string; s: TradeSide; commission: number; getting: boolean }) {
  return (
    <section className="trade-slot trade-column" aria-label={label}>
      <h4>{label}</h4>
      {givesSomething(s) ? (
        <>
          {s.galaxies.length ? (
            <ul className={`trade-cards n${s.galaxies.length}`}>
              {s.galaxies.map((g) => (
                <li key={g.id}>
                  <GalaxyCard galaxy={g} size={s.galaxies.length > 1 ? 112 : 150} />
                </li>
              ))}
            </ul>
          ) : null}
          {s.coins > 0 ? (
            <p className="trade-coins-chip">
              <Icon name="coin" />
              <span>{t.coinsChip(s.coins)}</span>
            </p>
          ) : null}
          {getting && s.coins > 0 ? <p className="panel-note">{t.net(s.coins - commissionOf(s.coins, commission))}</p> : null}
        </>
      ) : (
        <div className="trade-empty">{t.nothing}</div>
      )}
    </section>
  );
}

/** One step of the history: who did what, and the deal a proposal or counter-offer made. */
function EventLine({ e, them }: { e: TradeEvent; them: string }) {
  const what = e.kind === 'done' ? t.events.done : e.byMe ? t.eventsMine[e.kind] : t.events[e.kind](them);
  return (
    <li className={`trade-event ${e.kind}`}>
      <span className="trade-event-v">{t.version(e.version)}</span>
      <span>
        <b>{what}</b>
        {e.deal ? (
          <span className="trade-event-deal">
            {t.dealYouGive(dealText(e.deal.me))} · {t.dealGives(them, dealText(e.deal.them))}
          </span>
        ) : null}
      </span>
      <time dateTime={e.at}>{when(e.at)}</time>
    </li>
  );
}

/** One open trade: what I give and what I get, whose turn it is, its history, and confirming, countering or cancelling. */
function TradeCard({ v, rules, gateId }: { v: TradeView; rules: MyTrades['rules']; gateId: string | undefined }) {
  const titleId = useId();
  const confirm = useConfirmTrade();
  const cancel = useCancelTrade();
  const [changing, setChanging] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const u = v.them.username;
  const complete = givesSomething(v.me) && givesSomething(v.them);
  const yourTurn = complete && !v.me.confirmed;
  const error = confirm.error ?? cancel.error;
  return (
    <article className={`lip panel trade-card${yourTurn ? ' turn' : ''}`} aria-labelledby={titleId}>
      <header className="trade-card-head">
        <h3 id={titleId}>
          {t.with('')}
          <Link to={`/perfil/${encodeURIComponent(u)}`}>{u}</Link>
        </h3>
        <span className="panel-note">{t.until(day(v.expiresAt))}</span>
      </header>
      <div className="trade-sides">
        <SideView label={t.youGive} s={v.me} commission={rules.commission} getting={false} />
        <span className="trade-arrows" aria-hidden="true" />
        <SideView label={t.youGet} s={v.them} commission={rules.commission} getting />
      </div>
      <p className={`trade-state${yourTurn ? ' turn' : ''}`}>{stateOf(v)}</p>
      {error ? (
        <p className="field-error" role="alert">
          {errorText(error, copy.errors)}
        </p>
      ) : null}
      <div className="trade-actions">
        <button
          type="button"
          className="lip pill pill-solar"
          disabled={!rules.canTrade || !yourTurn || confirm.isPending}
          aria-describedby={!rules.canTrade ? gateId : undefined}
          onClick={() => confirm.mutate({ id: v.id, version: v.version })}
        >
          {t.confirm}
        </button>
        <button type="button" className="lip pill" aria-haspopup="dialog" disabled={!rules.canTrade} onClick={() => setChanging(true)}>
          {t.change}
        </button>
        <button type="button" className="lip pill danger" aria-label={t.withdrawOf(u)} onClick={() => setCancelling(true)}>
          {copy.market.cancel}
        </button>
      </div>
      {v.history.length ? (
        <details className="trade-history">
          <summary>{t.history(v.history.length)}</summary>
          <ol>
            {[...v.history].reverse().map((e, i) => (
              <EventLine key={`${e.at}-${i}`} e={e} them={u} />
            ))}
          </ol>
        </details>
      ) : null}
      {changing ? <TradeComposer username={u} trade={v} rules={rules} onDone={() => setChanging(false)} onClose={() => setChanging(false)} /> : null}
      {cancelling ? (
        <Dialog role="alertdialog" title={t.withdrawTitle(u)} onClose={() => setCancelling(false)} className="confirm">
          <p>{t.withdrawBody}</p>
          <div className="confirm-actions">
            <button type="button" className="lip pill" data-autofocus onClick={() => setCancelling(false)}>
              {t.keep}
            </button>
            <button
              type="button"
              className="lip pill danger"
              onClick={() => {
                cancel.mutate(v.id);
                setCancelling(false);
              }}
            >
              {t.withdraw}
            </button>
          </div>
        </Dialog>
      ) : null}
    </article>
  );
}

/** The Trueques tab of the market: the open trades, then the closed ones; how many more can be open. */
export function TradesPanel({ trades, gateId }: { trades: MyTrades; gateId: string | undefined }) {
  const r = trades.rules;
  return (
    <div className="trades">
      {trades.open.length === 0 ? (
        <div className="lip panel lb-empty">
          <p>{t.none}</p>
        </div>
      ) : (
        <div className="trade-list">
          {trades.open.map((v) => (
            <TradeCard key={v.id} v={v} rules={r} gateId={gateId} />
          ))}
        </div>
      )}
      <p className="panel-note">
        {t.openLeft(r.openTrades)} · {t.upTo(r.tradeGalaxies)}
      </p>
      {trades.closed.length > 0 ? (
        <section className="lip panel trade-closed">
          <h2>{t.closed}</h2>
          <ul className="market-rows">
            {trades.closed.map((v) => (
              <li key={v.id}>
                <span className={`trade-status ${v.status}`}>{t.statuses[v.status as 'done' | 'cancelled' | 'expired']}</span>
                <span>
                  {t.closedWith('')}
                  <Link to={`/perfil/${encodeURIComponent(v.them.username)}`}>{v.them.username}</Link>
                </span>
                <span className="trade-closed-g">{givesSomething(v.me) ? (v.status === 'done' ? t.gave(dealText(v.me)) : t.offered(dealText(v.me))) : t.nothing}</span>
                <span className="trade-closed-g">{givesSomething(v.them) ? (v.status === 'done' ? t.got(dealText(v.them)) : t.asked(dealText(v.them))) : t.nothing}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
