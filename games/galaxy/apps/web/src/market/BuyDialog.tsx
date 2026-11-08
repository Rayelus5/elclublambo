import type { MarketListing } from '@galaxy/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { useBuyListing } from '../api/market';
import { errorText } from '../auth/useMe';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';

const t = copy.market;

/** Buying is confirmed first, with the price and the balance it leaves; then «Es tuya» with the way to the collection. */
export function BuyDialog({ l, coins, onClose }: { l: MarketListing; coins: number; onClose: () => void }) {
  const buy = useBuyListing();
  const done = buy.data;
  // The balance when the dialog opened: after buying, the cached wallet is already the new one.
  const [before] = useState(coins);
  return (
    <Dialog role="alertdialog" title={t.buyTitle(l.galaxy.name)} onClose={onClose} className="confirm market-buy">
      <div className="market-buy-body">
        <GalaxyCard galaxy={l.galaxy} size={150} />
        <div>
          {done ? (
            <>
              <p className="market-bought" role="status">
                <Icon name="check" />
                <span>{t.bought}</span>
              </p>
              <p className="panel-note">{t.balanceAfter(before, done.wallet.coins)}</p>
            </>
          ) : (
            <>
              <p className="market-price">
                <Icon name="coin" />
                <span>{t.price(l.price)}</span>
              </p>
              <p className="panel-note">{t.balanceAfter(before, before - l.price)}</p>
            </>
          )}
          {buy.error ? (
            <p className="field-error" role="alert">
              {errorText(buy.error, copy.errors)}
            </p>
          ) : null}
        </div>
      </div>
      <div className="confirm-actions">
        {done ? (
          <>
            <button type="button" className="lip pill" onClick={onClose}>
              {t.keepLooking}
            </button>
            <Link to={`/coleccion/${done.galaxy.id}`} className="lip pill pill-solar" data-autofocus>
              {t.seeIt}
            </Link>
          </>
        ) : (
          <>
            <button type="button" className="lip pill" data-autofocus onClick={onClose}>
              {t.cancel}
            </button>
            <button type="button" className="lip pill pill-solar" disabled={buy.isPending || buy.isError} aria-busy={buy.isPending || undefined} onClick={() => buy.mutate(l.id)}>
              {t.confirmBuy(l.price)}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
