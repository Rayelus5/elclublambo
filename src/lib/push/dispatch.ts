import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAllowedPushEndpoint } from "@/lib/push/endpoint";

// `picked` = notices picked by the claim (same on every row). Rows with a null endpoint are notices whose recipient
// has no subscription; a row with a null notification_id is a sentinel carrying only `picked`.
type ClaimedRow = {
  notification_id: number | null;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  tag: string | null;
  picked: number;
};
// Internal route only (the SQL builds one of /foro/c/.., /foro/tickets/.., /foro/u/.., /foro/moderation/reports,
// /foro/admin/members, /foro/notifications, /foro/donar, /foro/sorteos[/..]); anything else is refused here too.
const INTERNAL_URL_RE = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*$/;

const BATCH = 200;
const MAX_BATCHES = 25;

/** Host only: the full endpoint carries the subscription secret and must never be logged. */
function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid-endpoint";
  }
}

/**
 * Claims the pending notifications (the SQL re-validates every recipient at send time) and sends one Web Push per
 * subscription. No-op without VAPID keys. Never throws.
 */
export async function dispatchPendingPush(): Promise<{ sent: number; removed: number }> {
  const result = { sent: 0, removed: 0 };
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return result;

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const admin = createAdminClient();
    const remove = async (endpoint: string) => {
      const { error: delError } = await admin.rpc("delete_push_subscription_by_endpoint", { p_endpoint: endpoint });
      if (delError) {
        console.error(`dispatchPendingPush: delete failed for ${hostOf(endpoint)}`);
        return;
      }
      result.removed += 1;
    };

    // Keep claiming while the previous claim picked a full batch (`picked`, not rows: unsubscribed or invalid notices
    // return few or no rows), so a
    // big fan-out (@everyone in Anuncios) is not left to expire. Bounded.
    for (let i = 0; i < MAX_BATCHES; i++) {
      const { data, error } = await admin.rpc("claim_push_notifications", { p_limit: BATCH });
      if (error) {
        console.error(`dispatchPendingPush: claim failed (${(error as { code?: string }).code ?? "unknown"})`);
        return result;
      }
      const rows = (data ?? []) as ClaimedRow[];
      await sendBatch(rows, remove, result);
      if (Math.max(0, ...rows.map((r) => r.picked ?? 0)) < BATCH) break;
    }
  } catch (e) {
    console.error(`dispatchPendingPush: ${e instanceof Error ? e.name : "unknown error"}`);
  }
  return result;
}

async function sendBatch(
  rows: ClaimedRow[],
  remove: (endpoint: string) => Promise<void>,
  result: { sent: number; removed: number },
) {
  // A rejected delete must never abort the rest of the batch.
  const safeRemove = async (endpoint: string) => {
    try {
      await remove(endpoint);
    } catch {
      console.error(`dispatchPendingPush: delete failed for ${hostOf(endpoint)}`);
    }
  };
  for (const row of rows) {
    if (!row.endpoint || !row.p256dh || !row.auth || !row.url || !row.tag) continue; // no subscription / sentinel
    try {
      if (!isAllowedPushEndpoint(row.endpoint)) {
        // Defence in depth: the table can only hold allowlisted endpoints, but never fetch anything else.
        console.error(`dispatchPendingPush: endpoint outside the allowlist (${hostOf(row.endpoint)})`);
        await safeRemove(row.endpoint);
        continue;
      }
      if (!INTERNAL_URL_RE.test(row.url)) {
        console.error("dispatchPendingPush: refusing a non-internal url");
        continue;
      }
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify({ title: row.title ?? "", body: row.body ?? "", url: row.url, tag: row.tag }),
        { TTL: 3600, urgency: row.tag.startsWith("mention:") ? "high" : "normal" },
      );
      result.sent += 1;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await safeRemove(row.endpoint);
      } else {
        console.error(`dispatchPendingPush: send failed (${status ?? "no status"}) for ${hostOf(row.endpoint)}`);
      }
    }
  }
}
