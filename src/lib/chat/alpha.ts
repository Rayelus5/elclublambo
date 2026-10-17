"use server";

import { docToPlainText, sanitizeDoc } from "@/lib/chat/content";
import { verifyLineaContract } from "@/lib/chat/linea";
import { ALPHA_ADDRESS_RE } from "@/lib/chat/model";
import { rpcErrorCode } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMBED_LINKS = 2048;

/**
 * Posts an Alpha thesis. The on-chain check happens here, on the server, and the message is written with the
 * service-role-only RPC `post_message_as`, so a client cannot skip the check. The author is always the member of
 * the session: no member id is ever read from the input.
 */
export async function postAlphaAction(input: {
  channelId: string;
  address: string;
  doc: unknown;
}): Promise<{ id?: string; error?: string; slowmodeSeconds?: number }> {
  if (typeof input.channelId !== "string" || !UUID_RE.test(input.channelId)) return { error: "invalid_input" };
  if (typeof input.address !== "string" || !ALPHA_ADDRESS_RE.test(input.address)) return { error: "invalid_input" };

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
  if ((bits & BigInt(EMBED_LINKS)) === 0n) return { error: "forbidden" };

  try {
    if (!(await verifyLineaContract(input.address))) return { error: "not_a_contract" };
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
  });
  if (error) {
    const code = rpcErrorCode(error);
    if (code !== "slowmode") return { error: code };
    const n = Number.parseInt((error as { details?: string | null }).details ?? "", 10);
    return { error: code, slowmodeSeconds: Number.isFinite(n) && n > 0 ? n : undefined };
  }
  return { id: String(data) };
}
