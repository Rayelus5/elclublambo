import type { MarketListing, MyMarket } from '@galaxy/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { useCancelListing } from '../api/market';
import { errorText } from '../auth/useMe';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';

const t = copy.market;
const day = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(new Date(iso));

/** One's listings on sale (each withdrawn after a confirmation) and the sales, with the buyer and what was collected. */
export function MyListings({ mine }: { mine: MyMarket }) {
  const cancel = useCancelListing();
  const [pending, setPending] = useState<MarketListing | null>(null);
  return (
    <div className="market-mine">
      <section className="lip panel">
        <h2>{t.onSale}</h2>
        {mine.active.length === 0 ? (
          <p className="panel-note">{t.noneOnSale}</p>
        ) : (
          <ul className="market-rows">
            {mine.active.map((l) => (
              <li key={l.id}>
                <GalaxyCard galaxy={l.galaxy} size={84} />
                <p className="market-card-name">
                  <b>{l.galaxy.name}</b>
                  <span>{t.until(day(l.expiresAt))}</span>
                </p>
                <span className="market-row-price">{t.price(l.price)}</span>
                <button type="button" className="lip pill small" aria-label={t.withdrawOf(l.galaxy.name)} disabled={cancel.isPending} onClick={() => setPending(l)}>
                  {t.withdraw}
                </button>
              </li>
            ))}
          </ul>
        )}
        {cancel.error ? (
          <p className="field-error" role="alert">
            {errorText(cancel.error, copy.errors)}
          </p>
        ) : null}
      </section>
      <section className="lip panel">
        <h2>{t.sold}</h2>
        {mine.sold.length === 0 ? (
          <p className="panel-note">{t.noneSold}</p>
        ) : (
          <ul className="market-rows">
            {mine.sold.map((l) => (
              <li key={l.id}>
                <GalaxyCard galaxy={l.galaxy} size={84} />
                <p className="market-card-name">
                  <b>{l.galaxy.name}</b>
                  <span>
                    {t.boughtBy} {l.buyer ? <Link to={`/perfil/${encodeURIComponent(l.buyer)}`}>{l.buyer}</Link> : null}
                  </span>
                </p>
                <span className="market-row-price">{t.price(l.price)}</span>
                <span className="market-net">{t.netGot(l.net)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {pending ? (
        <Dialog role="alertdialog" title={t.withdrawTitle(pending.galaxy.name)} onClose={() => setPending(null)} className="confirm">
          <p>{t.withdrawBody}</p>
          <div className="confirm-actions">
            <button type="button" className="lip pill" data-autofocus onClick={() => setPending(null)}>
              {t.cancel}
            </button>
            <button
              type="button"
              className="lip pill danger"
              onClick={() => {
                cancel.mutate(pending.id);
                setPending(null);
              }}
            >
              {t.withdraw}
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
