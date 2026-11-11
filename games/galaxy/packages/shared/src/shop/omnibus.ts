import { configSchemas } from '../config/registry';
import type { ShopConfig } from './schema';

// The «antes» price of a sale (shop and lab plan, F4; EU Omnibus directive): a lowered price may only be shown struck
// against the lowest price the product had in the 30 days before the sale started. The server works it out from the
// shop config's own history (each published version and when it was live); only time when the shop was open counts,
// and without any, nothing is struck.

export const REFERENCE_DAYS = 30;
const DAY_MS = 86_400_000;

export interface ShopVersion {
  /** When it was published. */
  at: Date;
  data: unknown;
}

/** The lowest price of `productId` in the 30 days before `saleStart`, or null when the shop never sold it then. */
export function referencePrice(history: readonly ShopVersion[], productId: string, saleStart: Date): number | null {
  const from = saleStart.getTime() - REFERENCE_DAYS * DAY_MS;
  const to = saleStart.getTime();
  const sorted = [...history].sort((a, b) => a.at.getTime() - b.at.getTime());
  let lowest: number | null = null;
  sorted.forEach((v, i) => {
    // The time this version was live, inside the window.
    const start = Math.max(v.at.getTime(), from);
    const end = Math.min(sorted[i + 1]?.at.getTime() ?? to, to);
    if (end <= start) return;
    const parsed = configSchemas.shop.safeParse(v.data);
    if (!parsed.success) return;
    const shop: ShopConfig = parsed.data;
    const p = shop.products.find((x) => x.id === productId);
    if (!shop.enabled || !p || !p.enabled) return;
    const prices = [p.priceCents];
    const o = p.offer;
    if (o?.kind === 'price' && Date.parse(o.startsAt) < end && Date.parse(o.endsAt) > start) prices.push(o.priceCents);
    for (const c of prices) lowest = lowest === null ? c : Math.min(lowest, c);
  });
  return lowest;
}
