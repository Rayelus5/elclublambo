"use server";

import { docToPlainText, sanitizeDoc } from "@/lib/chat/content";
import { verifyContract } from "@/lib/chat/contract";
import { ALPHA_ADDRESS_RE } from "@/lib/chat/model";
import { appChainIds, isChainId } from "@/lib/economy/networks";
import { rpcErrorCode } from "@/lib/errors";
import { schedulePushDispatch } from "@/lib/push/schedule";
import { hitRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEND_MESSAGES = 2;
const EMBED_LINKS = 2048;

/**
 * Posts an Alpha thesis. The on-chain check happens here, on the server, and the message is written with the
 * service-role-only RPC `post_message_as`, so a client cannot skip the check. The author is always the member of
 * the session: no member id is ever read from the input.
 */
export async function postAlphaAction(input: {
  channelId: string;
  chainId: number;
  address: string;
  doc: unknown;
}): Promise<{ id?: string; error?: string; slowmodeSeconds?: number }> {
  if (typeof input.channelId !== "string" || !UUID_RE.test(input.channelId)) return { error: "invalid_input" };
  if (typeof input.address !== "string" || !ALPHA_ADDRESS_RE.test(input.address)) return { error: "invalid_input" };

  // Only the build's own networks (Base and Arbitrum, mainnet or testnet); the RPC checks the chain again.
  if (!isChainId(input.chainId) || !appChainIds().includes(input.chainId)) return { error: "chain_invalid" };
  const chain = input.chainId;

  const doc = sanitizeDoc(input.doc);
  // post_message_as derives the text again; an empty thesis has nothing to show and the RPC rejects it.
  const text = docToPlainText(doc);
  if (text === "") return { error: "invalid_input" };

  const supabase = await createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { error: "not_authenticated" };

  const [me, status, perms, channel] = await Promise.all([
    supabase.rpc("current_member_id"),
    supabase.rpc("my_membership_status"),
    supabase.rpc("my_channel_permissions", { p_channel: input.channelId }),
    // RLS: a channel the member cannot see is not returned.
    supabase.from("channels").select("alpha_enabled, kind").eq("id", input.channelId).maybeSingle<{ alpha_enabled: boolean; kind: string }>(),
  ]);
  const memberId = me.data;
  if (me.error || typeof memberId !== "string" || status.data !== "active") return { error: "forbidden" };
  if (!channel.data || channel.data.kind !== "text" || !channel.data.alpha_enabled) return { error: "forbidden" };
  const bits = BigInt(String(perms.data ?? 0));
  // EMBED_LINKS for the Alpha card and SEND_MESSAGES to post at all: checked before the rate-limited on-chain lookup.
  if ((bits & BigInt(EMBED_LINKS)) === 0n || (bits & BigInt(SEND_MESSAGES)) === 0n) return { error: "forbidden" };

  // F5-R2 chain_verify pre-hit (its own transaction) before spending the on-chain lookup.
  const limit = await hitRateLimit(supabase, "chain_verify");
  if (limit !== "ok") return { error: limit === "rate_limited" ? "rate_limited" : "network" };

  try {
    if (!(await verifyContract(chain, input.address as `0x${string}`))) return { error: "not_a_contract" };
  } catch {
    return { error: "network" };
  }

  const { data, error } = await createAdminClient().rpc("post_message_as", {
    p_member: memberId,
    p_channel: input.channelId,
    p_body: doc,
    p_body_text: text,
    p_expanded: false,
    p_thread_root: null,
    p_quoted: null,
    p_attachments: [],
    p_alpha_address: input.address.toLowerCase(),
    p_alpha_chain: chain,
  });
  if (error) {
    const code = rpcErrorCode(error);
    if (code !== "slowmode") return { error: code };
    const n = Number.parseInt((error as { details?: string | null }).details ?? "", 10);
    return { error: code, slowmodeSeconds: Number.isFinite(n) && n > 0 ? n : undefined };
  }
  schedulePushDispatch();
  return { id: String(data) };
}
