// Treasurer panel helpers (isomorphic): date format and the «Avisos» (alerts) derived from the withdrawals, the Safe's
// USDC and the unexplained outflows. Amounts are bigint USDC (6 decimals).
import { knownErrorCode, rpcErrorMessage } from "@/lib/errors";
import type { ScanGap } from "@/lib/treasury/queries";
import { formatPrize, type PrizeToken, type TreasuryRaffle } from "@/lib/treasury/raffles";
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

/** Why the cron could not draw a raffle: the code's message, or a generic line for a code without one. */
export function drawRefusalText(code: string): string {
  return knownErrorCode(code) ? rpcErrorMessage(code) : "Error inesperado de la base de datos.";
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
  /** Drawn raffles more than 14 days after the draw with no payout recorded. */
  unpaidRaffles: { id: string; title: string; prize: string }[];
  /**
   * Prizes not yet paid, per token, that the Safe's balance does not cover. USDC: drawn prizes plus approved withdrawals.
   * WETH: open, closed and drawn prizes (the Safe may hold no WETH at all when a WETH raffle is created).
   */
  prizeUnderfunded: { token: PrizeToken; reserved: bigint; safe: bigint }[];
  /** Closed raffles whose draw the cron could not make (stored once per raffle and code; gone once drawn or cancelled). */
  refusedDraws: { id: string; title: string; code: string }[];
  /**
   * F4-R2: obligations still unpaid with an unexplained outflow to their destination in the payout window. While any
   * exists, every valuation (credits, approvals, snapshots) answers assets_stale. `who`: the member or the raffle title.
   */
  paused: { id: string; kind: "withdrawal" | "prize"; who: string; destination: string }[];
  /** F4-R1: the scan has not advanced for SCAN_GAP_RUNS runs or SCAN_GAP_HOURS hours. */
  scanStuck: ScanGap | null;
}

/** F4-R1: the scan is reported stuck after this many consecutive gap runs (the cron runs hourly)… */
export const SCAN_GAP_RUNS = 3;
/** …or once the first gap is this old. */
export const SCAN_GAP_HOURS = 3;

/** Drawn raffles whose prize the Safe still owes: no payout recorded yet. */
const prizeOwed = (r: TreasuryRaffle) => r.status === "drawn" && r.payoutTxHash === null && r.payoutRecordedAt === null;
/** WETH prizes still to be paid: open and closed raffles too, not only drawn ones. */
const wethPrizePending = (r: TreasuryRaffle) =>
  r.prizeToken === "WETH" && (r.status === "open" || r.status === "closed" || prizeOwed(r));

export function treasuryAlerts(input: {
  withdrawals: TreasuryWithdrawal[];
  /** The Safe's USDC (live or last snapshot); null when unknown. */
  safeUsdc: bigint | null;
  /** The Safe's WETH (live); null when unknown. */
  safeWeth?: bigint | null;
  raffles?: TreasuryRaffle[];
  unexplained: number;
  /** treasury_scan_gap: null while the scan advances. */
  scanGap?: ScanGap | null;
  now: Date;
}): TreasuryAlertsData {
  const raffles = input.raffles ?? [];
  const owed = raffles.filter(prizeOwed);
  const unpaidRaffles = owed.filter((r) => r.unpaid).map((r) => ({ id: r.id, title: r.title, prize: formatPrize(r.prizeAmount, r.prizeToken) }));
  const owedOf = (token: PrizeToken) => owed.filter((r) => r.prizeToken === token).reduce((sum, r) => sum + r.prizeAmount, 0n);
  const open = input.withdrawals.filter((w) => w.status === "approved" && w.amountUsdc !== null && !payoutRecorded(w));
  const limit = input.now.getTime() + EXPIRY_WARNING_HOURS * HOUR_MS;
  const expiring = open
    .filter((w) => w.expiresAt !== null && new Date(w.expiresAt).getTime() <= limit)
    .map((w) => ({ id: w.id, label: w.memberLabel, amountUsdc: w.amountUsdc!, expiresAt: w.expiresAt! }));
  const reserved = open.reduce((sum, w) => sum + w.amountUsdc!, 0n);
  const prizeUnderfunded: TreasuryAlertsData["prizeUnderfunded"] = [];
  const prizesUsdc = owedOf("USDC");
  if (input.safeUsdc !== null && prizesUsdc > 0n && prizesUsdc + reserved > input.safeUsdc) {
    prizeUnderfunded.push({ token: "USDC", reserved: prizesUsdc + reserved, safe: input.safeUsdc });
  }
  const prizesWeth = raffles.filter(wethPrizePending).reduce((sum, r) => sum + r.prizeAmount, 0n);
  if (input.safeWeth != null && prizesWeth > input.safeWeth) prizeUnderfunded.push({ token: "WETH", reserved: prizesWeth, safe: input.safeWeth });
  const refusedDraws = raffles
    .filter((r) => r.status === "closed" && r.drawRefused !== null)
    .map((r) => ({ id: r.id, title: r.title, code: r.drawRefused! }));
  const paused: TreasuryAlertsData["paused"] = [
    ...input.withdrawals
      .filter((w) => w.status === "approved" && w.unexplainedOutflow && !payoutRecorded(w))
      .map((w) => ({ id: w.id, kind: "withdrawal" as const, who: w.memberLabel, destination: w.wallet })),
    ...raffles
      .filter((r) => prizeOwed(r) && r.unexplainedOutflow && r.winnerAddress !== null)
      .map((r) => ({ id: r.id, kind: "prize" as const, who: r.title, destination: r.winnerAddress! })),
  ];
  const gap = input.scanGap ?? null;
  const scanStuck =
    gap && (gap.runs >= SCAN_GAP_RUNS || input.now.getTime() - new Date(gap.since).getTime() >= SCAN_GAP_HOURS * HOUR_MS) ? gap : null;
  return {
    unpaidRaffles,
    prizeUnderfunded,
    refusedDraws,
    paused,
    scanStuck,
    expiring,
    underfunded: input.safeUsdc !== null && reserved > input.safeUsdc ? { reserved, safeUsdc: input.safeUsdc } : null,
    unexplained: input.unexplained,
  };
}
