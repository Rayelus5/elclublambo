import { timingSafeEqual } from "node:crypto";
import { CHAIN_IDS, type ChainId } from "@/lib/economy/networks";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcile } from "@/lib/treasury/reconcile";
import { settlePendingDonations } from "@/lib/treasury/settle";

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
  credited?: number;
  reverted?: number;
  pending?: number;
  diff?: string;
  reconciliationId?: string;
  skipped?: "safe_not_configured";
  error?: string;
};

/** Settles pending donations and reconciles the Safe balance on both chains. Protected by `Authorization: Bearer ${CRON_SECRET}`. */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "cron_not_configured" }, { status: 503 });
  if (!authorized(request.headers.get("authorization"), secret)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data } = await createAdminClient().from("chain_config").select("chain_id, safe_address");
  const withSafe = new Set(
    ((data ?? []) as { chain_id: number; safe_address: string | null }[]).filter((c) => c.safe_address).map((c) => c.chain_id),
  );

  const chains: ChainReport[] = [];
  for (const chainId of CHAIN_IDS) {
    const report: ChainReport = { chainId };
    try {
      Object.assign(report, await settlePendingDonations(chainId));
      if (withSafe.has(chainId)) {
        const r = await reconcile(chainId, null);
        report.diff = r.diff.toString();
        report.reconciliationId = r.id;
      } else {
        report.skipped = "safe_not_configured";
      }
    } catch (e) {
      console.error("[cron/dao] failed", chainId, e);
      report.error = "failed";
    }
    chains.push(report);
  }
  return Response.json({ chains });
}
