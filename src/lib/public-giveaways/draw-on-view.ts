import "server-only";
import { drawOne } from "@/lib/giveaways/cron";
import { roundTime } from "@/lib/giveaways/drand";
import { safeError } from "@/lib/security/redact";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PublicGiveawayView } from "@/lib/public-giveaways/types";

/**
 * P2-R11: opening a giveaway that is due and whose drand round already exists closes and draws it (idempotent, the hourly
 * cron does the same). True when something changed, so the page reads again. Never throws. No revalidatePath here: this
 * runs while a page renders, where Next refuses it; the page is dynamic and simply re-reads.
 */
export async function maybeDrawOnView(view: PublicGiveawayView, nowMs = Date.now()): Promise<boolean> {
  try {
    if (view.status !== "open" && view.status !== "closed") return false;
    if (Date.parse(view.closesAt) > nowMs) return false;
    const round = BigInt(view.targetRound);
    if (roundTime(round) * 1000 > nowMs) return false;

    const db = createAdminClient();
    let changed = false;
    const closed = await db.rpc("close_due_public_giveaways");
    if (closed.error) {
      console.error("[public-giveaways] close_due_public_giveaways failed", safeError(closed.error.message));
    } else {
      const c = (closed.data ?? {}) as { closed?: unknown; voided?: unknown };
      changed = (Number(c.closed) || 0) + (Number(c.voided) || 0) > 0;
    }
    const outcome = await drawOne(db, view.id, round, nowMs, "draw_public_giveaway");
    return changed || outcome.status === "drawn";
  } catch (e) {
    console.error("[public-giveaways] draw on view failed", safeError(e));
    return false;
  }
}
