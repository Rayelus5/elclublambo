import { assetsFor, type AssetId } from "@/lib/economy/assets";
import { chainsForSet, networkSet, type NetworkKey } from "@/lib/economy/networks";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";
import { parseAmount } from "@/lib/payments/amounts";

type Opts = { amount?: string; asset?: AssetId };
type Query = URLSearchParams | Record<string, string | string[] | undefined>;

const AMOUNT_SHAPE = /^\d+(?:[.,]\d+)?$/;

/** "12,5" -> "12.5"; null when empty or not a plain decimal. */
function cleanAmount(text: string | undefined): string | null {
  const t = (text ?? "").trim();
  return AMOUNT_SHAPE.test(t) ? t.replace(",", ".") : null;
}

/** The public pay link of `target` (an alias or an address); amount and asset ride in the query, colon kept readable. */
export function buildPayUrl(origin: string, lang: Lang, target: string, opts: Opts = {}): string {
  const base = `${origin.replace(/\/+$/, "")}${localizedPath(lang, "pay", { target })}`;
  const q = new URLSearchParams();
  const amount = cleanAmount(opts.amount);
  if (amount !== null) q.set("amount", amount);
  if (opts.asset) q.set("asset", opts.asset);
  const qs = q.toString().replace(/%3A/gi, ":");
  return qs ? `${base}?${qs}` : base;
}

function first(q: Query, key: string): string | null {
  if (q instanceof URLSearchParams) return q.get(key);
  const v = q[key];
  return typeof v === "string" ? v : null;
}

/**
 * The amount and asset a pay link carries. Anything invalid is dropped: a negative or malformed amount, one with more
 * decimals than the asset, an asset outside this environment's closed list or of a network the recipient does not accept.
 */
export function parsePayQuery(q: Query, accept?: readonly NetworkKey[]): { amount: string | null; asset: AssetId | null } {
  const rawAsset = first(q, "asset");
  const allowed = assetsFor(chainsForSet(networkSet()), accept);
  const found = rawAsset === null ? undefined : allowed.find((a) => a.id === rawAsset);
  const asset = found ? found.id : null;
  const amount = cleanAmount(first(q, "amount") ?? undefined);
  if (amount === null) return { amount: null, asset };
  const units = found ? parseAmount(amount, found.token) : parseAmount(amount, "ETH");
  // Without an asset the widest scale (ETH, 18 decimals) is the only check.
  if (units === null || units <= 0n) return { amount: null, asset };
  return { amount, asset };
}
