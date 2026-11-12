import { SHOP_CURRENCIES, type ShopAmounts, type ShopConfig, type ShopProduct } from './schema';

// The shop's rules (shop and lab plan, F4), shared by the server (which charges and credits) and the web (which only
// shows what the server sends). Every number a player sees about a purchase comes from here, computed on the server.

export const NO_AMOUNTS: ShopAmounts = { coins: 0, dust: 0, components: 0 };

/** The product's offer running at `now` (start included, end not), or null. */
export function activeOffer(p: Pick<ShopProduct, 'offer'>, now: Date): ShopProduct['offer'] {
  const o = p.offer;
  if (!o) return null;
  const t = now.getTime();
  return t >= Date.parse(o.startsAt) && t < Date.parse(o.endsAt) ? o : null;
}

/** What it costs now and the Stripe price that charges it (a price offer has its own). */
export function effectivePrice(p: ShopProduct, now: Date): { cents: number; stripePriceId: string | null; endsAt: string | null } {
  const o = activeOffer(p, now);
  if (o?.kind === 'price') return { cents: o.priceCents, stripePriceId: o.stripePriceId, endsAt: o.endsAt };
  return { cents: p.priceCents, stripePriceId: p.stripePriceId, endsAt: o?.endsAt ?? null };
}

/** The extra share (percent) on top of what it always gives: a «+X % de regalo» offer and the first purchase, added. */
export function extraPercent(p: ShopProduct, now: Date, first: boolean, cfg: Pick<ShopConfig, 'firstPurchase'>): number {
  const o = activeOffer(p, now);
  return (o?.kind === 'bonus' ? o.percent : 0) + (first && p.firstBonus && cfg.firstPurchase.enabled ? cfg.firstPurchase.percent : 0);
}

/** What a purchase gives: `base` (grants and bonus), `extra` (offer and first purchase, rounded down) and the `total`. */
export function purchaseGrants(p: ShopProduct, now: Date, first: boolean, cfg: Pick<ShopConfig, 'firstPurchase'>): { base: ShopAmounts; extra: ShopAmounts; total: ShopAmounts } {
  const pct = extraPercent(p, now, first, cfg);
  const base = { ...NO_AMOUNTS };
  const extra = { ...NO_AMOUNTS };
  const totalOut = { ...NO_AMOUNTS };
  for (const c of SHOP_CURRENCIES) {
    base[c] = p.grants[c] + p.bonus[c];
    extra[c] = Math.floor((base[c] * pct) / 100);
    totalOut[c] = base[c] + extra[c];
  }
  return { base, extra, total: totalOut };
}

/** The tab it shows in: a pack in its currency's, bundles and the welcome pack in «packs». */
export function productTab(p: ShopProduct): 'coins' | 'dust' | 'components' | 'packs' | 'style' {
  if (p.kind === 'cosmetic') return 'style';
  if (p.kind !== 'pack') return 'packs';
  return SHOP_CURRENCIES.find((c) => p.grants[c] + p.bonus[c] > 0) ?? 'packs';
}

/** Why an account cannot buy a product now (null: it can). `daily_limit` is the server's: what is left of today's. */
export type ShopBlock = 'unavailable' | 'once_used' | 'daily_limit';

export function productBlock(p: ShopProduct, ctx: { staff: boolean; bought: number }): ShopBlock | null {
  if (!p.enabled || (p.staffOnly && !ctx.staff)) return 'unavailable';
  const max = p.kind === 'welcome' || p.kind === 'cosmetic' ? 1 : p.maxPerAccount;
  if (max !== null && ctx.bought >= max) return 'once_used';
  return null;
}

/** Whether the shop is open for this account: on, with its keys, and for its audience. */
export function shopOpenFor(cfg: Pick<ShopConfig, 'enabled' | 'audience'>, ready: boolean, staff: boolean): boolean {
  return cfg.enabled && ready && (cfg.audience === 'everyone' || staff);
}
