import type { MarketListing, MarketRules } from '@galaxy/shared';
import { useId, useState } from 'react';
import { useMakeOffer } from '../api/market';
import { errorText } from '../auth/useMe';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';

const t = copy.market;

/**
 * Making an offer (the owner, 2026-11-14: «hacer oferta … se reserva» the gold): the amount, between the rarity's floor
 * and the price less one (at the price, one buys), above one's own offer when raising it; what holding the coins
 * means and how long; what is left of one's offers. Sent, it says so.
 */
export function OfferDialog({ l, rules, coins, onClose }: { l: MarketListing; rules: MarketRules; coins: number; onClose: () => void }) {
  const ids = useId();
  const make = useMakeOffer();
  // At least the rarity's floor, and above one's own offer when raising it.
  const min = Math.max(rules.minPrice[l.galaxy.tier], (l.myOffer ?? 0) + 1);
  const max = l.price - 1;
  const [text, setText] = useState(String(Math.max(min, Math.min(max, Math.round(l.price * 0.85)))));
  const amount = /^\d{1,10}$/.test(text.trim()) ? Number(text.trim()) : NaN;
  const valid = Number.isFinite(amount) && amount >= min && amount <= max && amount <= coins;
  const done = make.data;
  return (
    <Dialog role="alertdialog" title={t.offerTitle(l.galaxy.name)} onClose={onClose} className="confirm market-buy market-offer">
      <div className="market-buy-body">
        <GalaxyCard galaxy={l.galaxy} size={150} />
        <div className="market-offer-form">
          {done ? (
            <>
              <p className="market-bought" role="status">
                <Icon name="check" />
                <span>{t.offerSent}</span>
              </p>
              <p className="panel-note">{t.offerSentDetail}</p>
            </>
          ) : (
            <>
              <p className="market-price">
                <Icon name="coin" />
                <span>{t.price(l.price)}</span>
              </p>
              <div className="field">
                <label htmlFor={`${ids}-amount`}>{t.offerAmount}</label>
                <div className="control">
                  <input
                    id={`${ids}-amount`}
                    type="number"
                    inputMode="numeric"
                    min={min}
                    max={max}
                    value={text}
                    aria-describedby={`${ids}-range ${ids}-hold`}
                    aria-invalid={!valid || undefined}
                    data-autofocus
                    onChange={(e) => {
                      setText(e.target.value);
                      if (make.error) make.reset();
                    }}
                  />
                </div>
                <p className="hint" id={`${ids}-range`}>
                  {t.offerRange(min, max)}
                  {Number.isFinite(amount) && amount > coins ? ` · ${t.missing(amount - coins)}` : ''}
                </p>
              </div>
              <p className="panel-note" id={`${ids}-hold`}>
                {t.offerHold(rules.offers.hours)}
              </p>
              <p className="panel-note">{t.offerLeft(rules.offers.openLeft, rules.offers.todayLeft)}</p>
            </>
          )}
          {make.error ? (
            <p className="field-error" role="alert">
              {errorText(make.error, copy.errors)}
            </p>
          ) : null}
        </div>
      </div>
      <div className="confirm-actions">
        {done ? (
          <button type="button" className="lip pill pill-solar" data-autofocus onClick={onClose}>
            {copy.collection.close}
          </button>
        ) : (
          <>
            <button type="button" className="lip pill" onClick={onClose}>
              {t.cancel}
            </button>
            <button type="button" className="lip pill pill-solar" disabled={!valid || make.isPending} aria-busy={make.isPending || undefined} onClick={() => make.mutate({ id: l.id, amount })}>
              {valid ? t.offerSend(amount) : t.offer}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
