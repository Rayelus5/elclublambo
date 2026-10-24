import "server-only";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcErrorCode } from "@/lib/errors";
import { fetchBeacon, roundTime } from "@/lib/giveaways/drand";
import { safeError } from "@/lib/security/redact";
import { createAdminClient } from "@/lib/supabase/admin";

export type GiveawayCycleReport = { closed: number; voided: number; drawn: number; waiting: number; failed: number };
/** The club cycle at the top level (P1 shape), the public giveaways (P2) under `public`. */
export type GiveawayReport = GiveawayCycleReport & { public: GiveawayCycleReport };

export type DrawRpc = "draw_giveaway" | "draw_public_giveaway";

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
 * beacon is fetched and BLS-verified (fetchBeacon), then draw_giveaway (club) or draw_public_giveaway (P2) recomputes
 * randomness = sha256(signature) and runs the draw in SQL. drand down never fails the giveaway: it stays closed and is
 * retried (Review Focus 5). draw_giveaway answers {status}, draw_public_giveaway a bare 'drawn' | 'already'.
 */
export async function drawOne(
  db: Admin,
  id: string,
  round: bigint,
  nowMs = Date.now(),
  rpc: DrawRpc = "draw_giveaway",
): Promise<DrawOutcome> {
  if (roundTime(round) * 1000 > nowMs) return { status: "waiting", code: "round_not_ready" };
  const beacon = await fetchBeacon(round);
  if (beacon.status === "unavailable") return { status: "waiting", code: "drand_unavailable" };
  if (beacon.status === "invalid") {
    console.error("[giveaways] invalid drand beacon", id, round.toString());
    return { status: "failed", code: "drand_invalid" };
  }
  const { data, error } = await db.rpc(rpc, { p_id: id, p_round: Number(round), p_signature: beacon.signature });
  if (error) {
    const code = rpcErrorCode(error);
    // the database clock trails ours by a moment: just retry later
    if (code === "round_not_ready") return { status: "waiting", code };
    console.error(`[giveaways] ${rpc} failed`, id, safeError(error.message));
    return { status: "failed", code };
  }
  const already = data === "already" || (data as { status?: unknown } | null)?.status === "already";
  return { status: already ? "already" : "drawn" };
}

type Cycle = { close: string; awaiting: string; draw: DrawRpc };
const CLUB: Cycle = { close: "close_due_giveaways", awaiting: "giveaways_awaiting_draw", draw: "draw_giveaway" };
const PUBLIC: Cycle = { close: "close_due_public_giveaways", awaiting: "public_giveaways_awaiting_draw", draw: "draw_public_giveaway" };

/** One close + draw cycle. `drand.down` is shared between cycles: once drand is unavailable it is not asked again. */
async function runCycle(db: Admin, cycle: Cycle, drand: { down: boolean }): Promise<GiveawayCycleReport> {
  const report: GiveawayCycleReport = { closed: 0, voided: 0, drawn: 0, waiting: 0, failed: 0 };

  const closed = await db.rpc(cycle.close);
  if (closed.error) {
    console.error(`[giveaways] ${cycle.close} failed`, safeError(closed.error.message));
  } else {
    const c = (closed.data ?? {}) as { closed?: unknown; voided?: unknown };
    report.closed = Number(c.closed) || 0;
    report.voided = Number(c.voided) || 0;
  }

  const awaiting = await db.rpc(cycle.awaiting);
  if (awaiting.error) throw new Error(`${cycle.awaiting}: ${awaiting.error.message}`);
  const rows = (Array.isArray(awaiting.data) ? awaiting.data : []) as { id: string; target_round: number | string }[];

  for (const row of rows) {
    if (drand.down) {
      report.waiting++;
      continue;
    }
    let outcome: DrawOutcome;
    try {
      outcome = await drawOne(db, row.id, BigInt(row.target_round), Date.now(), cycle.draw);
    } catch (e) {
      console.error("[giveaways] draw failed", row.id, safeError(e));
      outcome = { status: "failed", code: "unknown" };
    }
    if (outcome.status === "waiting" && outcome.code === "drand_unavailable") drand.down = true;
    if (outcome.status === "drawn" || outcome.status === "already") report.drawn++;
    else if (outcome.status === "waiting") report.waiting++;
    else report.failed++;
  }
  return report;
}

/**
 * P1-R12, hourly from /api/cron/dao (before the legacy branch, so it runs while the legacy DAO is paused): close the
 * due giveaways, then draw every closed one whose drand round exists; then the same for the public giveaways (P2). A
 * failed close is logged and the draws still run; a failed read of the closed giveaways throws (the route reports the
 * step as failed). Each draw is isolated. Once drand answers 'unavailable' in a run, every giveaway left, club or
 * public, counts as waiting without asking it again.
 */
export async function runGiveawaySteps(): Promise<GiveawayReport> {
  const db = createAdminClient();
  const drand = { down: false };
  const club = await runCycle(db, CLUB, drand);
  if (club.closed + club.voided + club.drawn > 0) revalidateGiveaways();
  const pub = await runCycle(db, PUBLIC, drand);
  return { ...club, public: pub };
}
