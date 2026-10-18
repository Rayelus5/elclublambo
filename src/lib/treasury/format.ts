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
