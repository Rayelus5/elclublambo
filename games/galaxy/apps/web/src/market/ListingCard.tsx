import type { MarketListing } from '@galaxy/shared';
import { useId } from 'react';
import { Link } from 'react-router';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';

const t = copy.market;

/**
 * A galaxy for sale (DESIGN_SYSTEM §8 quattuordecies): its card (with its name), rarity, price and seller (to their profile), then
 * «Comprar», or why not: one's own, the trade gates (described by the page's notice) or the coins missing.
 */
export function ListingCard({
  l,
  own,
  coins,
  gateId,
  canBuy,
  onBuy,
  onSee,
}: {
  l: MarketListing;
  own: boolean;
  coins: number | undefined;
  /** The page's notice that says why one cannot trade, when one cannot. */
  gateId: string | undefined;
  canBuy: boolean;
  onBuy: () => void;
  /** Its preview: the 3D card and its powers (the owner, 2026-11-14). */
  onSee?: () => void;
}) {
  const missingId = useId();
  const short = coins === undefined ? 0 : Math.max(0, l.price - coins);
  return (
    <li className="lip panel market-card" data-tier={l.galaxy.tier}>
      {onSee ? (
        <button type="button" className="market-card-see" aria-haspopup="dialog" aria-label={t.seeOf(l.galaxy.name)} onClick={onSee}>
          <GalaxyCard galaxy={l.galaxy} size={176} />
        </button>
      ) : (
        <GalaxyCard galaxy={l.galaxy} size={176} />
      )}
      <div className="market-card-body">
        <p className="market-tier">{copy.tiers[l.galaxy.tier]}</p>
        <p className="market-price">
          <Icon name="coin" />
          <span>{t.price(l.price)}</span>
        </p>
        <p className="market-seller">
          <Link to={`/perfil/${encodeURIComponent(l.seller)}`}>{l.seller}</Link>
        </p>
        {l.myOffer ? <p className="market-my-offer">{t.offerMine(l.myOffer)}</p> : l.offers ? <p className="market-offers-count">{t.offerCount(l.offers)}</p> : null}
        {own ? (
          <span className="market-yours">{t.yours}</span>
        ) : (
          <>
            <button
              type="button"
              className="lip pill pill-solar"
              aria-label={t.buyOf(l.galaxy.name)}
              disabled={!canBuy || short > 0}
              aria-describedby={!canBuy ? gateId : short > 0 ? missingId : undefined}
              onClick={onBuy}
            >
              {t.buy}
            </button>
            {canBuy && short > 0 ? (
              <span id={missingId} className="panel-note">
                {t.missing(short)}
              </span>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}
