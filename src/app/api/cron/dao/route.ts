import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { CHAIN_IDS, type ChainId } from "@/lib/economy/networks";
import { finalizeDuePolls } from "@/lib/polls/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { detectWithdrawalPayouts, expireWithdrawalApprovals, finalizeWithdrawalPayouts, scanCursorTime } from "@/lib/treasury/payouts";
import { runRaffleSteps, type RaffleReport } from "@/lib/treasury/raffle-cron";
import { scanSafeOperations } from "@/lib/treasury/scan";
import { settlePendingDonations } from "@/lib/treasury/settle";
import { takeSnapshot } from "@/lib/treasury/snapshot";

/** Constant-time bearer check: both buffers are padded to the same length for timingSafeEqual, then the true lengths must match. */
function authorized(header: string | null, secret: string): boolean {
  const given = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  const len = Math.max(given.length, expected.length, 1);
  const a = Buffer.alloc(len);
  const b = Buffer.alloc(len);
  given.copy(a);
  expected.copy(b);
  // timingSafeEqual needs equal lengths; the length check keeps a padded prefix from passing.
  return timingSafeEqual(a, b) && given.length === expected.length;
}

type ChainReport = {
  chainId: ChainId;
  snapshot?: Awaited<ReturnType<typeof takeSnapshot>> | "failed";
  scan?: Awaited<ReturnType<typeof scanSafeOperations>> | "failed";
  payouts?: { recorded: number; paid: number; reverted: number; pending: number } | "failed";
  /** F4d: close → draw → prize payouts (detect, finalize) → unpaid notices. */
  raffles?: RaffleReport;
  credited?: number;
  reverted?: number;
  pending?: number;
  skipped?: "safe_not_configured";
  error?: "settle_failed";
  /** Ruling F4c-R5: "skipped" when this run's scan failed (or its cursor time is unknown): nothing expires past it. */
  expiredApprovals?: number | "failed" | "skipped";
};

/**
 * First, once per run and before anything else (ruling F4e-R4): finalize the polls whose close has passed (DB-only,
 * chain-independent). Then per chain, in order (ruling F4c-R7 c): Safe operations scan → withdrawal payouts (detect the scanned outflows, then
 * burn the recorded ones at finality) → raffles (F4d: close due raffles, draw at the finalized first block after the
 * close, detect and finalize prize payouts, unpaid notices) → NAV snapshot (hourly, throttled in SQL) → settlement of pending donations at
 * market NAV. The scan comes first so every payout already mined is linked before anything is valued (and the
 * valuations read the Safe at the cursor it just reached while withdrawals are approved and unpaid). After
 * every chain, each chain's lapsed withdrawal approvals expire: detection runs first, so a payout mined inside the window
 * is recorded before its approval could lapse (Review Focus 4), and the expiry is bounded by the block time of the scan
 * cursor that chain just reached; a chain whose scan failed this run expires nothing (ruling F4c-R5). Each step is isolated: one failing never stops the others. Protected by
 * `Authorization: Bearer ${CRON_SECRET}`. POST for external schedulers, GET for Vercel Cron (which sends GET with the
 * same header); both share the handler.
 */
async function handle(request: Request) {
  // Opt out of prerendering: without this a GET with an unset CRON_SECRET could be baked into a static 503.
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "cron_not_configured" }, { status: 503 });
  if (!authorized(request.headers.get("authorization"), secret)) return Response.json({ error: "unauthorized" }, { status: 401 });

  // F4e-R4: polls first, once per run. The step is DB-only and chain-independent, so neither the chain_config read
  // nor a slow chain step can delay it: it bounds how long finished polls keep unsealed ballots and unsent notices. A
  // failure is isolated and reported, like any other step.
  let polls: Awaited<ReturnType<typeof finalizeDuePolls>> | "failed";
  try {
    polls = await finalizeDuePolls();
  } catch (e) {
    console.error("[cron/dao] polls failed", e);
    polls = "failed";
  }

  const { data, error } = await createAdminClient().from("chain_config").select("chain_id, safe_address");
  if (error) {
    console.error("[cron/dao] chain_config read failed", error.message);
    return Response.json({ error: "chain_config_unavailable", polls }, { status: 500 });
  }
  const withSafe = new Set(
    ((data ?? []) as { chain_id: number; safe_address: string | null }[]).filter((c) => c.safe_address).map((c) => c.chain_id),
  );

  const chains: ChainReport[] = [];
  const scannedThrough = new Map<ChainId, Date>();
  for (const chainId of CHAIN_IDS) {
    const report: ChainReport = { chainId };
    if (withSafe.has(chainId)) {
      try {
        report.scan = await scanSafeOperations(chainId);
        if (report.scan) {
          const at = await scanCursorTime(chainId);
          if (at) scannedThrough.set(chainId, at);
        }
      } catch (e) {
        console.error("[cron/dao] scan failed", chainId, e);
        report.scan = "failed";
      }
      // detect, then finalize; a failing half does not skip the other, and either failing reports the step as failed
      const detected = await detectWithdrawalPayouts(chainId).catch((e: unknown) => {
        console.error("[cron/dao] payout detection failed", chainId, e);
        return null;
      });
      const finalized = await finalizeWithdrawalPayouts(chainId).catch((e: unknown) => {
        console.error("[cron/dao] payout finalization failed", chainId, e);
        return null;
      });
      report.payouts = detected && finalized ? { ...detected, ...finalized } : "failed";
      // F4d: raffles after the withdrawal payouts (the scan already linked prize outflows, R4 order) and before the
      // snapshot, so a recorded or voided prize is settled before the fund is valued
      try {
        report.raffles = await runRaffleSteps(chainId);
      } catch (e) {
        console.error("[cron/dao] raffles failed", chainId, e);
        report.raffles = "failed";
      }
      // F4c-R7 (c): only after the scan, so a payout already mined is linked and the snapshot does not dip by it
      try {
        report.snapshot = await takeSnapshot(chainId);
      } catch (e) {
        console.error("[cron/dao] snapshot failed", chainId, e);
        report.snapshot = "failed";
      }
    } else {
      report.skipped = "safe_not_configured";
    }
    try {
      Object.assign(report, await settlePendingDonations(chainId));
    } catch (e) {
      console.error("[cron/dao] settle failed", chainId, e);
      report.error = "settle_failed";
    }
    chains.push(report);
  }

  for (const report of chains) {
    if (!withSafe.has(report.chainId)) continue;
    const at = scannedThrough.get(report.chainId);
    if (!at) {
      report.expiredApprovals = "skipped";
      continue;
    }
    try {
      report.expiredApprovals = await expireWithdrawalApprovals(report.chainId, at);
    } catch (e) {
      console.error("[cron/dao] approval expiry failed", report.chainId, e);
      report.expiredApprovals = "failed";
    }
  }
  return Response.json({ chains, polls });
}

export const POST = handle;
export const GET = handle;
