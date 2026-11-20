import { SHOP_CURRENCIES, type ShopAmounts, type ShopProductView } from '@galaxy/shared';
import { type CSSProperties, useRef, useState } from 'react';
import { copy } from '../copy/es';
import { Icon, type IconName } from '../ui/Icon';
import { PieceArt } from '../cosmetics/PieceArt';
import { artOf, SPRITE } from './art';
import { eur, usePackArt } from './art-hooks';
import { lastSaleDay, ownedCount, SetArt } from './SetArt';

// A product of the shop (shop and lab plan, F5; the approved F0 mockup): its art, name, what it gives (with its gift
// and, now, its extra), its badge and its price on the button. A product this account cannot buy says why and its
// button is off.

const t = copy.shop;
export const CURRENCY_ICON: Record<keyof ShopAmounts, IconName> = { coins: 'coin', dust: 'dust', components: 'wrench' };

/** Whether a set gives only probe skins (2026-11-17). */
export const allSkins = (p: Pick<ShopProductView, 'pieces'>) => !!p.pieces?.every((x) => x.kind === 'skin');

/** What a product gives in words: its piece for a cosmetic (Nov plan C5), its pieces for a set, else its amounts. */
export function giftText(p: Pick<ShopProductView, 'total' | 'cosmetic' | 'pieces'>): string {
  if (p.pieces) return t.set.amount(p.pieces.length, allSkins(p));
  return p.cosmetic ? t.piece[p.cosmetic.kind] : amountsText(p.total);
}

/** What a set says of the pieces the player has: «Tienes 3 de 8…», or null when none (or all). */
export function setOwnedText(p: Pick<ShopProductView, 'pieces'>): string | null {
  const have = ownedCount(p);
  const n = p.pieces?.length ?? 0;
  return have > 0 && have < n ? t.set.owned(have, n) : null;
}

/** What it gives, in words («2.500 monedas, 1.250 de polvo»). */
export function amountsText(a: ShopAmounts): string {
  return SHOP_CURRENCIES.filter((c) => a[c] > 0)
    .map((c) => t.amounts[c](a[c]))
    .join(', ');
}

export function PackCanvas({
  product,
  reduced,
  className,
  pieceSize,
  live = false,
}: {
  product: Pick<ShopProductView, 'art' | 'kind' | 'cosmetic' | 'pieces'>;
  reduced: boolean;
  className?: string;
  pieceSize?: 64 | 96;
  live?: boolean;
}) {
  if (product.pieces) return <SetArt pieces={product.pieces} reduced={reduced} live={live} scale={pieceSize === 96 ? 2 : 3} />;
  if (product.cosmetic) return <PieceArt piece={product.cosmetic} className={className} size={pieceSize} />;
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
  // A set's pieces all move while the card is pointed at or focused (one at a time otherwise).
  const [live, setLive] = useState(false);
  const until = product.availableUntil ? t.set.until(lastSaleDay(product.availableUntil)) : null;
  return (
    <article
      className={`lip panel pack-card tone-${product.pieces ? 'style' : (single ?? 'packs')}`}
      style={{ '--i': index } as CSSProperties}
      onPointerEnter={product.pieces ? () => setLive(true) : undefined}
      onPointerLeave={product.pieces ? () => setLive(false) : undefined}
      onFocus={product.pieces ? () => setLive(true) : undefined}
      onBlur={product.pieces ? () => setLive(false) : undefined}
    >
      <span className="pack-glow" aria-hidden="true" />
      {product.badge ? <span className={`pack-ribbon ${product.badge}`}>{t.badges[product.badge]}</span> : null}
      {product.first ? <span className="shop-tag gift pack-first">{t.first.tag(firstPercent)}</span> : null}
      <PackCanvas product={product} reduced={reduced} className="pack-art" pieceSize={96} live={live} />
      <h3 className="pack-name">{product.name}</h3>
      {product.pieces ? (
        <>
          <span className="pack-amount piece">{giftText(product)}</span>
          <span className="pack-bonus">{(product.owned ? null : setOwnedText(product)) ?? t.set.note(allSkins(product))}</span>
        </>
      ) : product.cosmetic ? (
        <>
          <span className="pack-amount piece">{t.piece[product.cosmetic.kind]}</span>
          <span className="pack-bonus">{product.cosmetic.kind === 'skin' ? t.pieceNoteSkin : t.pieceNote}</span>
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
      {until ? <span className="pack-offer">{until}</span> : null}
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
