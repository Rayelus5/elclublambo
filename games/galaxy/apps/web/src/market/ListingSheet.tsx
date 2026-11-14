import type { MarketListing } from '@galaxy/shared';
import { Link } from 'react-router';
import { copy } from '../copy/es';
import { RelicSheet } from '../hangar/RelicSheet';
import { Icon } from '../ui/Icon';

const t = copy.market;
const day = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/**
 * A listing seen up close (the owner, 2026-11-14: «previsualizar las galaxias con su carta 3D y sus poderes como en el
 * popup de "Reliquia", pero mejorado para la tienda»): the relic popup with the 3D card and its powers, the price, the
 * seller and until when it is on sale, and «Comprar» (or why not) beside «Cerrar».
 */
export function ListingSheet({
  l,
  own,
  canBuy,
  short,
  canOffer,
  onBuy,
  onOffer,
  onClose,
}: {
  l: MarketListing;
  own: boolean;
  canBuy: boolean;
  short: number;
  /** Offers are on, and one may still make one (2026-11-14). */
  canOffer: boolean;
  onBuy: () => void;
  onOffer: () => void;
  onClose: () => void;
}) {
  return (
    <RelicSheet
      galaxy={l.galaxy}
      heading={l.galaxy.name}
      mode="view"
      onClose={onClose}
      extra={
        <div className="listing-sheet-deal">
          <dl>
            <dt>{t.sheetPrice}</dt>
            <dd className="market-price">
              <Icon name="coin" />
              <span>{t.price(l.price)}</span>
            </dd>
          </dl>
          <dl>
            <dt>{t.sheetSeller}</dt>
            <dd>
              <Link to={`/perfil/${encodeURIComponent(l.seller)}`}>{l.seller}</Link>
            </dd>
          </dl>
          {l.offers ? (
            <dl>
              <dt>{t.offers.received}</dt>
              <dd>{t.offerCount(l.offers)}</dd>
            </dl>
          ) : null}
          {l.myOffer ? <p className="listing-sheet-mine">{t.offerMine(l.myOffer)}</p> : null}
          <p className="listing-sheet-ends">{t.sheetEnds(day.format(new Date(l.expiresAt)))}</p>
        </div>
      }
      actions={
        own ? (
          <span className="market-yours">{t.yours}</span>
        ) : (
          <>
            {canBuy && short > 0 ? <span className="panel-note">{t.missing(short)}</span> : null}
            <button type="button" className="lip pill listing-sheet-offer" aria-haspopup="dialog" disabled={!canOffer} onClick={onOffer}>
              <Icon name="flip" />
              <span>{l.myOffer ? t.raise : t.offer}</span>
            </button>
            <button type="button" className="lip pill pill-solar" data-autofocus disabled={!canBuy || short > 0} onClick={onBuy}>
              <Icon name="coin" />
              <span>{t.buy}</span>
            </button>
          </>
        )
      }
    />
  );
}
