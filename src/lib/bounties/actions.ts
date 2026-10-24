"use server";

import { docToPlainText, sanitizeDoc } from "@/lib/chat/content";
import { appChainIds, isChainId, type ChainId } from "@/lib/economy/networks";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/errors";
import { parseAmount, type Token } from "@/lib/payments/amounts";
import type { TipIntent } from "@/lib/payments/tip-actions";
import { schedulePushDispatch } from "@/lib/push/schedule";
import { createServerClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const isToken = (v: unknown): v is Token => v === "ETH" || v === "USDC";

type Fail = { ok: false; error: string; code: string; slowmodeSeconds?: number };
const fail = (code: string): Fail => ({ ok: false, code, error: rpcErrorMessage(code) });

/** Review Focus 5: invalid_input when it is not a network at all, chain_invalid when this build does not use it. */
function chainError(chainId: unknown): "invalid_input" | "chain_invalid" | null {
  if (!isChainId(chainId)) return "invalid_input";
  return appChainIds().includes(chainId) ? null : "chain_invalid";
}

export async function createBountyAction(input: {
  channelId: string;
  body: unknown;
  /** The announced network (P0-R4): the bounty can still be paid on any network the solver accepts. */
  chainId: ChainId;
  token: Token;
  amount: string;
}): Promise<{ ok: true; messageId: string } | Fail> {
  const { channelId, body, chainId, token, amount } = input ?? ({} as typeof input);
  if (!isUuid(channelId) || !isToken(token) || typeof amount !== "string") return fail("invalid_input");
  const badChain = chainError(chainId);
  if (badChain) return fail(badChain);
  const units = parseAmount(amount, token);
  if (units === null || units <= 0n) return fail("invalid_input");

  // Never trust the client doc: sanitize it here (the SQL core validates it again).
  const doc = sanitizeDoc(body);
  if (docToPlainText(doc) === "") return fail("invalid_input");

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("create_bounty", {
    p_channel: channelId,
    p_body: doc,
    p_chain_id: chainId,
    p_token: token,
    p_amount: units.toString(),
  });
  if (error) {
    const code = rpcErrorCode(error);
    if (code !== "slowmode") return fail(code);
    // The remaining seconds come in the error DETAIL; the composer starts its countdown with them.
    const n = Number.parseInt((error as { details?: string | null }).details ?? "", 10);
    return Number.isFinite(n) && n > 0 ? { ...fail(code), slowmodeSeconds: n } : fail(code);
  }
  if (!data) return fail("unknown");
  schedulePushDispatch();
  return { ok: true, messageId: String(data) };
}

export async function markSolutionAction(bountyId: string, replyId: string): Promise<{ ok: true } | Fail> {
  if (!isUuid(bountyId) || !isUuid(replyId)) return fail("invalid_input");
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("mark_bounty_solution", { p_bounty: bountyId, p_reply: replyId });
  if (error) return fail(rpcErrorCode(error));
  schedulePushDispatch();
  return { ok: true };
}

export async function cancelBountyAction(bountyId: string): Promise<{ ok: true } | Fail> {
  if (!isUuid(bountyId)) return fail("invalid_input");
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("cancel_bounty", { p_bounty: bountyId });
  if (error) return fail(rpcErrorCode(error));
  return { ok: true };
}

export async function createBountyPaymentIntentAction(input: {
  bountyId: string;
  /** Any enabled network the solver accepts; the token is always the bounty's (P0-R4). */
  chainId: ChainId;
  amount: string;
}): Promise<{ ok: true; intent: TipIntent } | Fail> {
  const { bountyId, chainId, amount } = input ?? ({} as typeof input);
  if (!isUuid(bountyId) || typeof amount !== "string") return fail("invalid_input");
  const badChain = chainError(chainId);
  if (badChain) return fail(badChain);
  const supabase = await createServerClient();
  // The amount is typed in the bounty's own token, which the client does not send: read it (RLS-scoped) to scale it.
  const token = await bountyToken(supabase, bountyId);
  if (token === "error") return fail("unknown");
  if (!token) return fail("not_found");
  const units = parseAmount(amount, token);
  if (units === null || units <= 0n) return fail("invalid_input");
  const { data, error } = await supabase.rpc("create_bounty_payment_intent", {
    p_bounty: bountyId,
    p_chain_id: chainId,
    p_amount: units.toString(),
  });
  if (error) return fail(rpcErrorCode(error));
  if (!data) return fail("unknown");
  return { ok: true, intent: data as TipIntent };
}

/** The bounty's token; null only when the read succeeded with no visible bounty, "error" when the read failed (transient). */
async function bountyToken(supabase: Awaited<ReturnType<typeof createServerClient>>, bountyId: string): Promise<Token | null | "error"> {
  const { data, error } = await supabase.rpc("bounty_details", { p_message_ids: [bountyId] });
  if (error || !Array.isArray(data)) return "error";
  const row = data[0] as { token?: unknown } | undefined;
  return isToken(row?.token) ? row.token : null;
}
