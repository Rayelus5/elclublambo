import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { CHAIN_IDS, type ChainId } from "@/lib/economy/networks";
import { createAdminClient } from "@/lib/supabase/admin";
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
  credited?: number;
  reverted?: number;
  pending?: number;
  skipped?: "safe_not_configured";
  error?: "settle_failed";
};

/**
 * Per chain, in order: NAV snapshot (hourly, throttled in SQL) → Safe operations scan → settlement of pending donations
 * at market NAV. Each step is isolated: one failing never stops the others. Protected by
 * `Authorization: Bearer ${CRON_SECRET}`. POST for external schedulers, GET for Vercel Cron (which sends GET with the
 * same header); both share the handler.
 */
async function handle(request: Request) {
  // Opt out of prerendering: without this a GET with an unset CRON_SECRET could be baked into a static 503.
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "cron_not_configured" }, { status: 503 });
  if (!authorized(request.headers.get("authorization"), secret)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await createAdminClient().from("chain_config").select("chain_id, safe_address");
  if (error) {
    console.error("[cron/dao] chain_config read failed", error.message);
    return Response.json({ error: "chain_config_unavailable" }, { status: 500 });
  }
  const withSafe = new Set(
    ((data ?? []) as { chain_id: number; safe_address: string | null }[]).filter((c) => c.safe_address).map((c) => c.chain_id),
  );

  const chains: ChainReport[] = [];
  for (const chainId of CHAIN_IDS) {
    const report: ChainReport = { chainId };
    if (withSafe.has(chainId)) {
      try {
        report.snapshot = await takeSnapshot(chainId);
      } catch (e) {
        console.error("[cron/dao] snapshot failed", chainId, e);
        report.snapshot = "failed";
      }
      try {
        report.scan = await scanSafeOperations(chainId);
      } catch (e) {
        console.error("[cron/dao] scan failed", chainId, e);
        report.scan = "failed";
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
  return Response.json({ chains });
}

export const POST = handle;
export const GET = handle;
