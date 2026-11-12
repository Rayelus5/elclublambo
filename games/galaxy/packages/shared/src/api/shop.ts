import { z } from 'zod';
import type { Wallet } from '../gacha/types';
import type { ShopBlock } from '../shop/rules';
import type { ShopAmounts, ShopProduct } from '../shop/schema';

// The resource shop's API (shop and lab plan, F4). The server computes every price and amount; the web shows them.
// Paying is two steps: `checkout` keeps the purchase (with the consent) and opens Stripe's payment, and the purchase
// is delivered when Stripe says it is paid (its webhook, or the purchase's own check as a fallback), then pushed on
// the live socket.

export const SHOP_PURCHASE_STATUSES = ['creating', 'pending', 'paid', 'expired', 'failed', 'refunded', 'partially_refunded', 'disputed'] as const;
export type ShopPurchaseStatus = (typeof SHOP_PURCHASE_STATUSES)[number];

export interface ShopProductView {
  id: string;
  kind: ShopProduct['kind'];
  tab: 'coins' | 'dust' | 'components' | 'packs' | 'style';
  /** A cosmetic's piece (Nov plan C5), null for the rest; `owned`: the player has it already (bought or earned). */
  cosmetic?: { kind: 'avatar' | 'frame' | 'title' | 'skin'; id: string } | null;
  owned?: boolean;
  name: string;
  art: string;
  /** What it always gives (grants and bonus), what the offer and the first purchase add now, and the sum. */
  base: ShopAmounts;
  /** The gift inside `base` («1.000 + 200 de regalo»). */
  bonus: ShopAmounts;
  extra: ShopAmounts;
  total: ShopAmounts;
  priceCents: number;
  /** The lowest price of the 30 days before a price offer (EU Omnibus), or null: no struck price without it. */
  beforeCents: number | null;
  offer: { kind: 'bonus'; percent: number; endsAt: string } | { kind: 'price'; endsAt: string } | null;
  badge: ShopProduct['badge'];
  featured: boolean;
  /** Its first purchase gives more, and this account has not used it. */
  first: boolean;
  maxPerAccount: number | null;
  bought: number;
  /** Why this account cannot buy it now, or null. */
  block: ShopBlock | null;
}

export interface ShopView {
  open: boolean;
  /** Why it is not open for me: off (or not for me yet), or my account's shop is blocked. */
  closed: 'closed' | 'blocked' | null;
  /** Stripe's publishable key, to load its payment form (null while closed). */
  publishableKey: string | null;
  products: ShopProductView[];
  limits: { dailyCents: number; spentTodayCents: number; pendingMax: number };
  firstPurchase: { enabled: boolean; percent: number };
  legal: { seller: string; contact: string; termsVersion: string };
  wallet: Wallet;
}

/** Opening a payment: the product, the consent box ticked and the terms' version it accepted. */
export const shopCheckoutSchema = z
  .object({ product: z.string().regex(/^[a-z0-9-]{1,32}$/), consent: z.literal(true), terms: z.string().regex(/^[a-z0-9-]{1,32}$/) })
  .strict();
export type ShopCheckoutRequest = z.infer<typeof shopCheckoutSchema>;

export interface ShopCheckout {
  purchase: string;
  /** For Stripe's payment form (Checkout Sessions with Elements). */
  clientSecret: string;
}

export interface ShopPurchaseView {
  id: string;
  product: string;
  name: string;
  status: ShopPurchaseStatus;
  amountCents: number;
  /** What it gives (or gave, once paid). */
  grants: ShopAmounts;
  createdAt: string;
  paidAt: string | null;
  wallet: Wallet;
}
