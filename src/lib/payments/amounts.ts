export type Token = "ETH" | "USDC";

export const TOKEN_DECIMALS: Record<Token, number> = { ETH: 18, USDC: 6 };

/** Per-tip limits in base units: USDC 0.01..100000, ETH 0.00001..100. */
export const TIP_LIMITS: Record<Token, { min: bigint; max: bigint }> = {
  USDC: { min: 10_000n, max: 100_000n * 10n ** 6n },
  ETH: { min: 10n ** 13n, max: 100n * 10n ** 18n },
};

/** "12,5" / "12.5" -> base units. Null when empty, negative, malformed or with more decimals than the token has. */
export function parseAmount(text: string, token: Token): bigint | null {
  const m = /^(\d+)(?:[.,](\d+))?$/.exec(text.trim());
  if (!m) return null;
  const dec = TOKEN_DECIMALS[token];
  const frac = m[2] ?? "";
  if (frac.length > dec) return null;
  return BigInt(m[1]!) * 10n ** BigInt(dec) + BigInt(frac.padEnd(dec, "0") || "0");
}

/** Base units -> text with a Spanish decimal comma and no trailing zeros. Mirrors SQL public._format_token_amount. */
export function formatAmount(units: bigint, token: Token): string {
  const dec = TOKEN_DECIMALS[token];
  const unit = 10n ** BigInt(dec);
  const frac = (units % unit).toString().padStart(dec, "0").replace(/0+$/, "");
  return `${units / unit}${frac ? `,${frac}` : ""}`;
}
