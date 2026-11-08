import type { MyTrades, TradeView } from '@galaxy/shared';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { useCancelTrade, useConfirmTrade } from '../api/trades';
import { errorText } from '../auth/useMe';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { TradeComposer } from './TradeComposer';

const t = copy.trades;
const day = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(new Date(iso));

/** Whose turn it is, said plainly. */
function stateOf(v: TradeView): string {
  if (!v.me.galaxy || !v.them.galaxy) return t.incomplete;
  if (v.me.confirmed && !v.them.confirmed) return t.waiting(v.them.username);
  if (!v.me.confirmed && v.them.confirmed) return t.theyConfirmed(v.them.username);
  return t.review;
}

/** One open trade: what I give and what I get, whose turn it is, and confirming, changing or cancelling it. */
function TradeCard({ v, canTrade, gateId, days }: { v: TradeView; canTrade: boolean; gateId: string | undefined; days: number }) {
  const titleId = useId();
  const confirm = useConfirmTrade();
  const cancel = useCancelTrade();
  const [changing, setChanging] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const u = v.them.username;
  const complete = v.me.galaxy !== null && v.them.galaxy !== null;
  const yourTurn = complete && !v.me.confirmed;
  const error = confirm.error ?? cancel.error;
  const side = (label: string, g: TradeView['me']['galaxy']) => (
    <section className="trade-slot" aria-label={label}>
      <h4>{label}</h4>
      {g ? <GalaxyCard galaxy={g} size={150} /> : <div className="trade-empty">{t.nothing}</div>}
    </section>
  );
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
        {side(t.youGive, v.me.galaxy)}
        <span className="trade-arrows" aria-hidden="true" />
        {side(t.youGet, v.them.galaxy)}
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
          disabled={!canTrade || !yourTurn || confirm.isPending}
          aria-describedby={!canTrade ? gateId : undefined}
          onClick={() => confirm.mutate({ id: v.id, version: v.version })}
        >
          {t.confirm}
        </button>
        <button type="button" className="lip pill" disabled={!canTrade} onClick={() => setChanging(true)}>
          {t.change}
        </button>
        <button type="button" className="lip pill danger" aria-label={t.withdrawOf(u)} onClick={() => setCancelling(true)}>
          {copy.market.cancel}
        </button>
      </div>
      {changing ? <TradeComposer username={u} trade={v} days={days} onDone={() => setChanging(false)} onClose={() => setChanging(false)} /> : null}
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
            <TradeCard key={v.id} v={v} canTrade={r.canTrade} gateId={gateId} days={r.tradeDays} />
          ))}
        </div>
      )}
      <p className="panel-note">{t.openLeft(r.openTrades)}</p>
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
                <span className="trade-closed-g">{v.me.galaxy ? (v.status === 'done' ? t.gave(v.me.galaxy.name) : t.offered(v.me.galaxy.name)) : t.nothing}</span>
                <span className="trade-closed-g">{v.them.galaxy ? (v.status === 'done' ? t.got(v.them.galaxy.name) : t.asked(v.them.galaxy.name)) : t.nothing}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
