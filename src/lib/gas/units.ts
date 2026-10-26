import { formatUnits } from "viem";

export type Unit = "wei" | "gwei" | "eth" | "usd";

const DECIMALS = { wei: 0, gwei: 9, eth: 18 } as const;
/** USD input is read with up to 18 decimals (anything finer is not a number anyone types). */
const USD_DECIMALS = 18;
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/** "12,5" or "12.5" -> 12500… scaled to `decimals`, exactly; null when it is not a plain number or is finer than that. */
function toScaled(value: string, decimals: number): bigint | null {
  const v = value.trim().replace(",", ".");
  if (!NUMBER.test(v)) return null;
  const [int = "", rawFrac = ""] = v.split(".");
  const frac = rawFrac.replace(/0+$/, "");
  if (frac.length > decimals) return null;
  return BigInt((int || "0") + frac.padEnd(decimals, "0"));
}

function fromCents(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** USD for an amount of wei at `ethUsdE8` (8 decimals), rounded to cents. */
export function usdFromWei(wei: bigint, ethUsdE8: bigint): string {
  // wei × price / 10^(18 + 8) dollars = / 10^24 cents.
  return fromCents((wei * ethUsdE8 + 5n * 10n ** 23n) / 10n ** 24n);
}

/** gwei or ETH, truncated to `maxDecimals` without trailing zeros; a non-zero amount below that shows as «< 0.0…1». */
export function formatWei(wei: bigint, unit: "gwei" | "eth", maxDecimals: number): string {
  const [int = "0", rawFrac = ""] = formatUnits(wei, DECIMALS[unit]).split(".");
  const frac = rawFrac.slice(0, maxDecimals).replace(/0+$/, "");
  const out = frac ? `${int}.${frac}` : int;
  if (out !== "0" || wei === 0n) return out;
  return maxDecimals === 0 ? "< 1" : `< 0.${"0".repeat(maxDecimals - 1)}1`;
}

/**
 * The same amount in every unit, with integer arithmetic only (no Number for wei). Accepts a decimal comma. Null when
 * the input is not a non-negative number, is finer than a wei, or is USD without a price. Without a price, `usd` is "".
 * USD has 2 decimals (from USD, the input truncated to cents); ETH has at most 18.
 */
export function convert(value: string, from: Unit, ethUsdE8: bigint | null): Record<Unit, string> | null {
  let wei: bigint;
  let usd = "";
  if (from === "usd") {
    if (ethUsdE8 === null || ethUsdE8 <= 0n) return null;
    const usd18 = toScaled(value, USD_DECIMALS);
    if (usd18 === null) return null;
    wei = (usd18 * 10n ** 8n) / ethUsdE8;
    usd = fromCents(usd18 / 10n ** BigInt(USD_DECIMALS - 2));
  } else {
    const scaled = toScaled(value, DECIMALS[from]);
    if (scaled === null) return null;
    wei = scaled;
    if (ethUsdE8 !== null && ethUsdE8 > 0n) usd = usdFromWei(wei, ethUsdE8);
  }
  return { wei: wei.toString(), gwei: formatUnits(wei, 9), eth: formatUnits(wei, 18), usd };
}
