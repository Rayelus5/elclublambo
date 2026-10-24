import "server-only";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcErrorCode } from "@/lib/errors";
import { fetchBeacon, roundTime } from "@/lib/giveaways/drand";
import { safeError } from "@/lib/security/redact";
import { createAdminClient } from "@/lib/supabase/admin";

export type GiveawayReport = { closed: number; voided: number; drawn: number; waiting: number; failed: number };

/** One draw attempt: "waiting" leaves the giveaway closed for the next try (round not emitted, drand down). */
export type DrawOutcome =
  | { status: "drawn" | "already" }
  | { status: "waiting"; code: "round_not_ready" | "drand_unavailable" }
  | { status: "failed"; code: string };

type Admin = Pick<SupabaseClient, "rpc">;

export function revalidateGiveaways() {
  revalidatePath("/sorteos");
  revalidatePath("/sorteos/[id]", "page");
}

/**
 * The draw step for one closed giveaway (cron and «Sortear ahora»): its target round must already be emitted, the
 * beacon is fetched and BLS-verified (fetchBeacon), then draw_giveaway recomputes randomness = sha256(signature) and
 * runs the draw in SQL. drand down never fails the giveaway: it stays closed and is retried (Review Focus 5).
 */
export async function drawOne(db: Admin, id: string, round: bigint, nowMs = Date.now()): Promise<DrawOutcome> {
  if (roundTime(round) * 1000 > nowMs) return { status: "waiting", code: "round_not_ready" };
  const beacon = await fetchBeacon(round);
  if (beacon.status === "unavailable") return { status: "waiting", code: "drand_unavailable" };
  if (beacon.status === "invalid") {
    console.error("[giveaways] invalid drand beacon", id, round.toString());
    return { status: "failed", code: "drand_invalid" };
  }
  const { data, error } = await db.rpc("draw_giveaway", { p_id: id, p_round: Number(round), p_signature: beacon.signature });
  if (error) {
    const code = rpcErrorCode(error);
    // the database clock trails ours by a moment: just retry later
    if (code === "round_not_ready") return { status: "waiting", code };
    console.error("[giveaways] draw_giveaway failed", id, safeError(error.message));
    return { status: "failed", code };
  }
  return { status: (data as { status?: unknown } | null)?.status === "already" ? "already" : "drawn" };
}

/**
 * P1-R12, hourly from /api/cron/dao (before the legacy branch, so it runs while the legacy DAO is paused): close the
 * due giveaways, then draw every closed one whose drand round exists. A failed close is logged and the draws still
 * run; a failed read of the closed giveaways throws (the route reports the step as failed). Each draw is isolated.
 */
export async function runGiveawaySteps(): Promise<GiveawayReport> {
  const db = createAdminClient();
  const report: GiveawayReport = { closed: 0, voided: 0, drawn: 0, waiting: 0, failed: 0 };

  const closed = await db.rpc("close_due_giveaways");
  if (closed.error) {
    console.error("[giveaways] close_due_giveaways failed", safeError(closed.error.message));
  } else {
    const c = (closed.data ?? {}) as { closed?: unknown; voided?: unknown };
    report.closed = Number(c.closed) || 0;
    report.voided = Number(c.voided) || 0;
  }

  const awaiting = await db.rpc("giveaways_awaiting_draw");
  if (awaiting.error) throw new Error(`giveaways_awaiting_draw: ${awaiting.error.message}`);
  const rows = (Array.isArray(awaiting.data) ? awaiting.data : []) as { id: string; target_round: number | string }[];

  for (const row of rows) {
    let outcome: DrawOutcome;
    try {
      outcome = await drawOne(db, row.id, BigInt(row.target_round));
    } catch (e) {
      console.error("[giveaways] draw failed", row.id, safeError(e));
      outcome = { status: "failed", code: "unknown" };
    }
    if (outcome.status === "drawn" || outcome.status === "already") report.drawn++;
    else if (outcome.status === "waiting") report.waiting++;
    else report.failed++;
  }

  if (report.closed + report.voided + report.drawn > 0) revalidateGiveaways();
  return report;
}
