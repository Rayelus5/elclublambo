import { formatAmount } from "@/lib/payments/amounts";

/** Digits grouped by thousands with a dot, as Spanish prints them in tables. */
function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Base units of USDC -> "1.234,5 USDC" (decimal comma, no trailing zeros, no float rounding). */
export function formatUsdc(units: bigint): string {
  const [whole, frac] = formatAmount(units, "USDC").split(",");
  return `${group(whole!)}${frac ? `,${frac}` : ""} USDC`;
}

/** USD with 6 decimals (USD6) -> "2.500 USD" / "370,37 USD": thousands grouped, cents at most (truncated, never floats). */
export function formatUsd(usd6: bigint): string {
  const neg = usd6 < 0n;
  const abs = neg ? -usd6 : usd6;
  const cents = (abs % 1_000_000n) / 10_000n;
  const frac = cents.toString().padStart(2, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${group((abs / 1_000_000n).toString())}${frac ? `,${frac}` : ""} USD`;
}

/**
 * The value of one participación (USD6), which starts near 1 USD and moves by fractions of a cent: up to 4 decimals
 * (truncated, trailing zeros dropped) so 1,255 does not collapse to 1,25; all 6 when 4 would print a non-zero value as 0.
 */
export function formatUsdPrecise(usd6: bigint): string {
  const neg = usd6 < 0n;
  const abs = neg ? -usd6 : usd6;
  const whole = abs / 1_000_000n;
  const rest = abs % 1_000_000n;
  const digits = whole === 0n && rest > 0n && rest < 100n ? 6 : 4;
  const frac = rest.toString().padStart(6, "0").slice(0, digits).replace(/0+$/, "");
  return `${neg ? "-" : ""}${group(whole.toString())}${frac ? `,${frac}` : ""} USD`;
}

/** Assets the Safe holds. WETH has 18 decimals like ETH. */
export type FundAsset = "USDC" | "ETH" | "WETH";

/** Base units of a fund asset -> "1.500 WETH" / "0,25 ETH" (exact: every significant decimal, no trailing zeros). */
export function formatToken(units: bigint, asset: FundAsset): string {
  const [whole, frac] = formatAmount(units, asset === "USDC" ? "USDC" : "ETH").split(",");
  return `${group(whole!)}${frac ? `,${frac}` : ""} ${asset}`;
}

/** Basis points -> "0,2 %" / "12,34 %". */
export function formatBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = String(Math.abs(bps % 100)).padStart(2, "0").replace(/0+$/, "");
  return `${whole}${frac ? `,${frac}` : ""} %`;
}

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** Shares are numeric(78,0): up to 6 digits as is, beyond that "2,0·10¹⁹" (one decimal, truncated; never through Number). */
export function formatShares(shares: bigint): string {
  const s = (shares < 0n ? -shares : shares).toString();
  if (s.length <= 6) return `${shares < 0n ? "-" : ""}${group(s)}`;
  const exp = String(s.length - 1)
    .split("")
    .map((d) => SUPERSCRIPT[Number(d)])
    .join("");
  return `${shares < 0n ? "-" : ""}${s[0]},${s[1]}·10${exp}`;
}
