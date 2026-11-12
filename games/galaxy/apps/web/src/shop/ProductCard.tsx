import { SHOP_CURRENCIES, type ShopAmounts, type ShopProductView } from '@galaxy/shared';
import { type CSSProperties, useRef } from 'react';
import { copy } from '../copy/es';
import { Icon, type IconName } from '../ui/Icon';
import { artOf, SPRITE } from './art';
import { eur, usePackArt } from './art-hooks';
import { useCosmeticsView } from '../api/cosmetics';
import { Avatar } from '../hub/Avatar';
import { TitleText } from '../profile/TitleText';

// A product of the shop (shop and lab plan, F5; the approved F0 mockup): its art, name, what it gives (with its gift
// and, now, its extra), its badge and its price on the button. A product this account cannot buy says why and its
// button is off.

const t = copy.shop;
export const CURRENCY_ICON: Record<keyof ShopAmounts, IconName> = { coins: 'coin', dust: 'dust', components: 'wrench' };

/** What a product gives in words: its piece for a cosmetic (Nov plan C5), else its amounts. */
export function giftText(p: Pick<ShopProductView, 'total' | 'cosmetic'>): string {
  return p.cosmetic ? t.piece[p.cosmetic.kind] : amountsText(p.total);
}

/** A cosmetic's piece, drawn (Nov plan C5): the avatar, a frame round the default face, or the title in its style. */
function PieceArt({ piece, className }: { piece: NonNullable<ShopProductView['cosmetic']>; className?: string }) {
  const catalog = useCosmeticsView().data?.catalog;
  return (
    <span className={`piece-art ${className ?? ''}`.trim()} aria-hidden="true">
      {piece.kind === 'title' ? <TitleText text={piece.id} catalog={catalog} /> : <Avatar name="ECN" avatar={piece.kind === 'avatar' ? piece.id : 'crew-pilot'} frame={piece.kind === 'frame' ? piece.id : null} size={64} />}
    </span>
  );
}

/** What it gives, in words («2.500 monedas, 1.250 de polvo»). */
export function amountsText(a: ShopAmounts): string {
  return SHOP_CURRENCIES.filter((c) => a[c] > 0)
    .map((c) => t.amounts[c](a[c]))
    .join(', ');
}

export function PackCanvas({ product, reduced, className }: { product: Pick<ShopProductView, 'art' | 'kind' | 'cosmetic'>; reduced: boolean; className?: string }) {
  if (product.cosmetic) return <PieceArt piece={product.cosmetic} className={className} />;
  return <PackDrawing art={product.art} kind={product.kind} reduced={reduced} className={className} />;
}

function PackDrawing({ art, kind, reduced, className }: { art: string; kind: ShopProductView['kind']; reduced: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  usePackArt(ref, artOf(art, kind), reduced);
  return <canvas ref={ref} width={SPRITE} height={SPRITE} className={className} aria-hidden="true" />;
}

/** Its block in words, or null when it can be bought. */
export function blockText(p: ShopProductView): string | null {
  if (p.block === 'once_used') return t.owned;
  if (p.block === 'daily_limit') return t.overLimit;
  if (p.block === 'unavailable') return copy.errors.shop_unavailable;
  return null;
}

export function ProductCard({ product, index, firstPercent, reduced, onBuy }: { product: ShopProductView; index: number; firstPercent: number; reduced: boolean; onBuy: (p: ShopProductView) => void }) {
  const given = SHOP_CURRENCIES.filter((c) => product.total[c] > 0);
  const single = product.kind === 'pack' && given.length === 1 ? given[0]! : null;
  const why = blockText(product);
  const price = eur(product.priceCents);
  return (
    <article className={`lip panel pack-card tone-${single ?? 'packs'}`} style={{ '--i': index } as CSSProperties}>
      <span className="pack-glow" aria-hidden="true" />
      {product.badge ? <span className={`pack-ribbon ${product.badge}`}>{t.badges[product.badge]}</span> : null}
      {product.first ? <span className="shop-tag gift pack-first">{t.first.tag(firstPercent)}</span> : null}
      <PackCanvas product={product} reduced={reduced} className="pack-art" />
      <h3 className="pack-name">{product.name}</h3>
      {product.cosmetic ? (
        <>
          <span className="pack-amount piece">{t.piece[product.cosmetic.kind]}</span>
          <span className="pack-bonus">{t.pieceNote}</span>
        </>
      ) : single ? (
        <>
          <span className={`pack-amount cur-${single}`}>
            <Icon name={CURRENCY_ICON[single]} />
            {t.amounts[single](product.total[single])}
          </span>
          <span className="pack-bonus">{product.bonus[single] > 0 ? t.gift(product.base[single] - product.bonus[single], product.bonus[single]) : null}</span>
          {product.extra[single] > 0 ? <span className="pack-extra">{t.extra(product.extra[single])}</span> : null}
        </>
      ) : (
        <>
          <span className="pack-amount several">
            {given.map((c) => (
              <span key={c} className={`cur-${c}`}>
                <Icon name={CURRENCY_ICON[c]} />
                {t.amounts[c](product.total[c])}
              </span>
            ))}
          </span>
          <span className="pack-bonus">{product.kind === 'welcome' ? t.once : t.together}</span>
        </>
      )}
      {product.offer ? (
        <span className="pack-offer">{product.offer.kind === 'bonus' ? t.offerBonus(product.offer.percent) : t.offerPrice}</span>
      ) : null}
      {product.beforeCents !== null ? <s className="pack-before">{t.before(eur(product.beforeCents))}</s> : null}
      <button type="button" className="lip pill pill-solar pack-price" disabled={why !== null} aria-label={why ?? t.buyOf(product.name, price)} onClick={() => onBuy(product)}>
        {why ?? price}
      </button>
    </article>
  );
}
