import { commissionOf, type MarketOffer, type MarketRules } from '@galaxy/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { useMarketOffers, useOfferAction } from '../api/market';
import { errorText } from '../auth/useMe';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { CoinAmount } from '../ui/CoinAmount';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';

const t = copy.market;
const o = t.offers;
const day = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** One offer: its galaxy, the amount against the price, who, its state and until when, and what one can do. */
function OfferRow({ x, side, busy, onAccept, onReject, onWithdraw }: { x: MarketOffer; side: 'received' | 'sent'; busy: boolean; onAccept: () => void; onReject: () => void; onWithdraw: () => void }) {
  const open = x.status === 'open';
  return (
    <li className={`market-offer-row status-${x.status}`}>
      <GalaxyCard galaxy={x.listing.galaxy} size={84} />
      <div className="market-offer-main">
        <b>{x.listing.galaxy.name}</b>
        <span className="market-price">
          <Icon name="coin" />
          <CoinAmount n={x.amount} />
        </span>
        <span className="panel-note">
          {side === 'received' ? o.by(x.buyer) : o.to(x.listing.seller)} · {o.price(x.listing.price)}
        </span>
        <span className={`admin-chip${open ? ' ok' : x.status === 'accepted' ? ' ok' : ''}`}>{o.statuses[x.status]}</span>
        {open ? <span className="panel-note">{o.ends(day.format(new Date(x.expiresAt)))}</span> : null}
      </div>
      <div className="market-offer-actions">
        {open && side === 'received' ? (
          <>
            <button type="button" className="lip pill pill-solar small" aria-haspopup="dialog" disabled={busy} onClick={onAccept}>
              {o.accept}
            </button>
            <button type="button" className="lip pill small" aria-label={o.rejectOf(x.buyer)} disabled={busy} onClick={onReject}>
              {o.reject}
            </button>
          </>
        ) : null}
        {open && side === 'sent' ? (
          <button type="button" className="lip pill small" aria-label={o.withdrawOf(x.listing.galaxy.name)} disabled={busy} onClick={onWithdraw}>
            {o.withdraw}
          </button>
        ) : null}
        {x.status === 'accepted' && side === 'sent' ? (
          <Link to={`/coleccion/${x.listing.galaxy.id}`} className="lip pill small">
            {copy.notices.see}
          </Link>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Ofertas (the owner, 2026-11-14): the offers on my listings (accept, after a confirmation that says what I get and that
 * the others close; or reject) and mine (withdraw), with how much of my coins they hold.
 */
export function OffersPanel({ rules }: { rules: MarketRules }) {
  const offers = useMarketOffers();
  const act = useOfferAction();
  const [accepting, setAccepting] = useState<MarketOffer | null>(null);
  const v = offers.data;
  if (offers.error)
    return (
      <p className="field-error" role="alert">
        {errorText(offers.error, copy.errors)}
      </p>
    );
  if (!v)
    return (
      <p className="planetarium-wait" role="status" aria-label={copy.loading}>
        ⠋⠙⠹
      </p>
    );
  const row = (x: MarketOffer, side: 'received' | 'sent') => (
    <OfferRow
      key={x.id}
      x={x}
      side={side}
      busy={act.isPending}
      onAccept={() => setAccepting(x)}
      onReject={() => act.mutate({ id: x.id, action: 'reject' })}
      onWithdraw={() => act.mutate({ id: x.id, action: 'withdraw' })}
    />
  );
  return (
    <div className="market-offers">
      {act.error ? (
        <p className="field-error" role="alert">
          {errorText(act.error, copy.errors)}
        </p>
      ) : null}
      <section aria-labelledby="offers-received">
        <h2 id="offers-received">{o.received}</h2>
        {v.received.length === 0 ? <p className="panel-note">{o.noneReceived}</p> : <ul className="market-offer-list">{v.received.map((x) => row(x, 'received'))}</ul>}
      </section>
      <section aria-labelledby="offers-sent">
        <h2 id="offers-sent">
          {o.sent}
          {v.held > 0 ? <span className="admin-chip">{t.held(v.held)}</span> : null}
        </h2>
        {v.sent.length === 0 ? <p className="panel-note">{o.noneSent}</p> : <ul className="market-offer-list">{v.sent.map((x) => row(x, 'sent'))}</ul>}
      </section>
      {accepting ? (
        <Dialog role="alertdialog" title={o.acceptOf(accepting.listing.galaxy.name, accepting.amount)} onClose={() => setAccepting(null)} className="confirm">
          <p>{o.acceptBody(accepting.amount - commissionOf(accepting.amount, rules.commission))}</p>
          <div className="confirm-actions">
            <button type="button" className="lip pill" data-autofocus onClick={() => setAccepting(null)}>
              {t.cancel}
            </button>
            <button
              type="button"
              className="lip pill pill-solar"
              disabled={act.isPending}
              onClick={() => act.mutate({ id: accepting.id, action: 'accept' }, { onSettled: () => setAccepting(null) })}
            >
              {o.accept}
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
