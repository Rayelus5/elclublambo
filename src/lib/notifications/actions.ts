"use server";

import { rpcErrorCode } from "@/lib/errors";
import { isAllowedPushEndpoint } from "@/lib/push/endpoint";
import { createServerClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 200;
const MAX_KEY_LENGTH = 512;

type Result = { error?: string };

/** `null` marks every unread notice of the caller as read. */
export async function markNotificationsReadAction(ids: number[] | null): Promise<Result> {
  if (ids !== null) {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every((n) => Number.isSafeInteger(n) && n > 0)) {
      return { error: "invalid_input" };
    }
  }
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("mark_notifications_read", { p_ids: ids });
  return error ? { error: rpcErrorCode(error) } : {};
}

export async function setChannelFollowAction(channelId: string, level: "all" | "mentions" | "mute"): Promise<Result> {
  if (typeof channelId !== "string" || !UUID_RE.test(channelId) || !["all", "mentions", "mute"].includes(level)) {
    return { error: "invalid_input" };
  }
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_channel_follow", { p_channel: channelId, p_level: level });
  return error ? { error: rpcErrorCode(error) } : {};
}

export async function savePushSubscriptionAction(sub: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<Result> {
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  const validKey = (k: unknown): k is string => typeof k === "string" && k.length > 0 && k.length <= MAX_KEY_LENGTH;
  // The database repeats the allowlist check (anti-SSRF); failing early saves a round trip.
  if (typeof endpoint !== "string" || !isAllowedPushEndpoint(endpoint) || !validKey(p256dh) || !validKey(auth)) {
    return { error: "invalid_input" };
  }
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("save_push_subscription", { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth });
  return error ? { error: rpcErrorCode(error) } : {};
}

export async function deletePushSubscriptionAction(endpoint: string): Promise<Result> {
  if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > 2048) return { error: "invalid_input" };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("delete_push_subscription", { p_endpoint: endpoint });
  return error ? { error: rpcErrorCode(error) } : {};
}
