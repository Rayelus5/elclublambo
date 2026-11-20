import { z } from 'zod';
import { usernameSchema } from '../account';
import type { ShopAmounts } from '../shop/schema';
import { SHOP_PURCHASE_STATUSES, type ShopPurchaseStatus } from './shop';

// The resource shop in the admin panel (shop and lab plan, F4): what it earns, every purchase, the alerts (refunds,
// disputes, prices or amounts that do not match), the blocked accounts, and the Stripe prices checked against the
// catalogue (or made for it). Blocking, unblocking and making prices carry the admin's password and a reason.

export interface AdminShopSummary {
  /** The live config: on, for whom, and whether the server has Stripe's keys (and of which mode). */
  enabled: boolean;
  audience: 'staff' | 'everyone';
  ready: boolean;
  mode: 'live' | 'test' | null;
  paid: { todayCents: number; weekCents: number; monthCents: number; allCents: number; count: number; buyers: number };
  refundedCents: number;
  disputed: number;
  openAlerts: number;
  blocked: number;
  /** Paid purchases by product, the most sold first. */
  products: { product: string; name: string; count: number; cents: number }[];
}

export interface AdminShopPurchase {
  id: string;
  username: string;
  product: string;
  name: string;
  status: ShopPurchaseStatus;
  amountCents: number;
  refundedCents: number;
  firstBonus: boolean;
  grants: ShopAmounts;
  createdAt: string;
  paidAt: string | null;
}

export const ADMIN_SHOP_ALERT_KINDS = ['refund', 'dispute', 'dispute_closed', 'price_mismatch', 'amount_mismatch', 'unfulfilled'] as const;

export interface AdminShopAlert {
  id: string;
  kind: (typeof ADMIN_SHOP_ALERT_KINDS)[number];
  username: string | null;
  purchase: string | null;
  product: string | null;
  details: Record<string, unknown>;
  createdAt: string;
  reviewedAt: string | null;
  reviewer: string | null;
}

export interface AdminShopBlock {
  username: string;
  reason: string;
  purchase: string | null;
  createdAt: string;
  by: string | null;
}

/** One Stripe price of the catalogue checked against what the shop shows (and the «antes» of a sale running now). */
export interface AdminPriceCheck {
  product: string;
  name: string;
  where: 'price' | 'offer';
  priceId: string | null;
  expectedCents: number;
  stripeCents: number | null;
  problem: null | 'missing' | 'unreadable' | 'amount' | 'currency' | 'inactive' | 'recurring' | 'mode';
  beforeCents: number | null;
}

export const adminShopPurchasesQuerySchema = z
  .object({
    status: z.enum(SHOP_PURCHASE_STATUSES).optional(),
    username: usernameSchema.optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .strict();

const reason = z.string().trim().min(3).max(300);
const password = z.string().min(1).max(200);
export const adminShopReviewSchema = z.object({ reason }).strict();
export const adminShopBlockSchema = z.object({ reason, password }).strict();
export const adminShopCreatePricesSchema = z.object({ reason, password }).strict();

/** A Stripe price made for the catalogue: the admin puts it in the product (or its sale) and publishes. */
export interface AdminCreatedPrice {
  product: string;
  where: 'price' | 'offer';
  cents: number;
  priceId: string;
}
