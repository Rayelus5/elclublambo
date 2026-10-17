import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAllowedPushEndpoint } from "@/lib/push/endpoint";

type ClaimedRow = {
  notification_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  url: string;
  tag: string;
};

// Internal route only (the SQL builds one of /c/.., /tickets/.., /u/.., /moderation/reports, /admin/members,
// /notifications); anything else is refused here too.
const INTERNAL_URL_RE = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*$/;

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
    const { data, error } = await admin.rpc("claim_push_notifications", { p_limit: 200 });
    if (error) {
      console.error(`dispatchPendingPush: claim failed (${(error as { code?: string }).code ?? "unknown"})`);
      return result;
    }

    const remove = async (endpoint: string) => {
      const { error: delError } = await admin.rpc("delete_push_subscription_by_endpoint", { p_endpoint: endpoint });
      if (delError) {
        console.error(`dispatchPendingPush: delete failed for ${hostOf(endpoint)}`);
        return;
      }
      result.removed += 1;
    };

    for (const row of (data ?? []) as ClaimedRow[]) {
      try {
        if (!isAllowedPushEndpoint(row.endpoint)) {
          // Defence in depth: the table can only hold allowlisted endpoints, but never fetch anything else.
          console.error(`dispatchPendingPush: endpoint outside the allowlist (${hostOf(row.endpoint)})`);
          await remove(row.endpoint);
          continue;
        }
        if (!INTERNAL_URL_RE.test(row.url)) {
          console.error("dispatchPendingPush: refusing a non-internal url");
          continue;
        }
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify({ title: row.title, body: row.body, url: row.url, tag: row.tag }),
          { TTL: 3600, urgency: row.tag.startsWith("mention:") ? "high" : "normal" },
        );
        result.sent += 1;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await remove(row.endpoint);
        } else {
          console.error(`dispatchPendingPush: send failed (${status ?? "no status"}) for ${hostOf(row.endpoint)}`);
        }
      }
    }
  } catch (e) {
    console.error(`dispatchPendingPush: ${e instanceof Error ? e.name : "unknown error"}`);
  }
  return result;
}
