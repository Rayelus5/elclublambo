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
export function ListingSheet({ l, own, canBuy, short, onBuy, onClose }: { l: MarketListing; own: boolean; canBuy: boolean; short: number; onBuy: () => void; onClose: () => void }) {
  return (
    <RelicSheet
      galaxy={l.galaxy}
      heading={l.galaxy.name}
      mode="view"
      onClose={onClose}
      extra={
        <dl className="listing-sheet-deal">
          <div>
            <dt>{t.sheetPrice}</dt>
            <dd className="market-price">
              <Icon name="coin" />
              <span>{t.price(l.price)}</span>
            </dd>
          </div>
          <div>
            <dt>{t.sheetSeller}</dt>
            <dd>
              <Link to={`/perfil/${encodeURIComponent(l.seller)}`}>{l.seller}</Link>
            </dd>
          </div>
          <p className="listing-sheet-ends">{t.sheetEnds(day.format(new Date(l.expiresAt)))}</p>
        </dl>
      }
      actions={
        own ? (
          <span className="market-yours">{t.yours}</span>
        ) : (
          <>
            {canBuy && short > 0 ? <span className="panel-note">{t.missing(short)}</span> : null}
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
