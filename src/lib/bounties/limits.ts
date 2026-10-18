import type { Token } from "@/lib/payments/amounts";

/** Announced bounty amount limits in base units: USDC 1..100000, ETH 0.0001..100. Mirrors SQL create_bounty (amount_out_of_range). */
export const BOUNTY_LIMITS: Record<Token, { min: bigint; max: bigint }> = {
  USDC: { min: 10n ** 6n, max: 100_000n * 10n ** 6n },
  ETH: { min: 10n ** 14n, max: 100n * 10n ** 18n },
};
