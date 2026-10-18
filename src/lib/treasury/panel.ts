// Treasurer panel helpers (isomorphic): date format and the «Avisos» (alerts) derived from the withdrawals, the Safe's
// USDC and the unexplained outflows. Amounts are bigint USDC (6 decimals).
import type { TreasuryWithdrawal } from "@/lib/treasury/withdrawals";

const HOUR_MS = 3_600_000;
/** Approvals that lapse within this window are called out. */
export const EXPIRY_WARNING_HOURS = 48;

/** "18 oct 2026, 10:00 UTC": fixed zone so the server and the browser print the same text. */
export function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso)) + " UTC";
}

/** "1 nov 2026" (UTC). */
export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));
}

/** True when the Safe's payout for the request has been recorded (it may still await finality). */
export const payoutRecorded = (w: Pick<TreasuryWithdrawal, "payoutRecordedAt" | "payoutTxHash">) =>
  w.payoutRecordedAt !== null || w.payoutTxHash !== null;

export interface TreasuryAlertsData {
  /** Approved, unpaid requests lapsing within 48 h. */
  expiring: { id: string; label: string; amountUsdc: bigint; expiresAt: string }[];
  /** Approved, unpaid amounts versus the Safe's USDC; null when covered or when the balance is unknown. */
  underfunded: { reserved: bigint; safeUsdc: bigint } | null;
  /** Outflows without a note. */
  unexplained: number;
}

export function treasuryAlerts(input: {
  withdrawals: TreasuryWithdrawal[];
  /** The Safe's USDC (live or last snapshot); null when unknown. */
  safeUsdc: bigint | null;
  unexplained: number;
  now: Date;
}): TreasuryAlertsData {
  const open = input.withdrawals.filter((w) => w.status === "approved" && w.amountUsdc !== null && !payoutRecorded(w));
  const limit = input.now.getTime() + EXPIRY_WARNING_HOURS * HOUR_MS;
  const expiring = open
    .filter((w) => w.expiresAt !== null && new Date(w.expiresAt).getTime() <= limit)
    .map((w) => ({ id: w.id, label: w.memberLabel, amountUsdc: w.amountUsdc!, expiresAt: w.expiresAt! }));
  const reserved = open.reduce((sum, w) => sum + w.amountUsdc!, 0n);
  return {
    expiring,
    underfunded: input.safeUsdc !== null && reserved > input.safeUsdc ? { reserved, safeUsdc: input.safeUsdc } : null,
    unexplained: input.unexplained,
  };
}
