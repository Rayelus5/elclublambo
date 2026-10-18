"use server";

import { docToPlainText, sanitizeDoc } from "@/lib/chat/content";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/errors";
import { parseAmount, type Token } from "@/lib/payments/amounts";
import type { TipIntent } from "@/lib/payments/tip-actions";
import { schedulePushDispatch } from "@/lib/push/schedule";
import { createServerClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const isToken = (v: unknown): v is Token => v === "ETH" || v === "USDC";

type Fail = { ok: false; error: string; code: string };
const fail = (code: string): Fail => ({ ok: false, code, error: rpcErrorMessage(code) });

export async function createBountyAction(input: {
  channelId: string;
  body: unknown;
  token: Token;
  amount: string;
}): Promise<{ ok: true; messageId: string } | Fail> {
  const { channelId, body, token, amount } = input ?? ({} as typeof input);
  if (!isUuid(channelId) || !isToken(token) || typeof amount !== "string") return fail("invalid_input");
  const units = parseAmount(amount, token);
  if (units === null || units <= 0n) return fail("invalid_input");

  // Never trust the client doc: sanitize it here (the SQL core validates it again).
  const doc = sanitizeDoc(body);
  if (docToPlainText(doc) === "") return fail("invalid_input");

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("create_bounty", {
    p_channel: channelId,
    p_body: doc,
    p_token: token,
    p_amount: units.toString(),
  });
  if (error) return fail(rpcErrorCode(error));
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
  amount: string;
  feeBps: number;
}): Promise<{ ok: true; intent: TipIntent } | Fail> {
  const { bountyId, amount, feeBps } = input ?? ({} as typeof input);
  if (!isUuid(bountyId) || typeof amount !== "string" || !Number.isInteger(feeBps) || feeBps < 0 || feeBps > 5000) {
    return fail("invalid_input");
  }
  const supabase = await createServerClient();
  // The amount is typed in the bounty's own token, which the client does not send: read it (RLS-scoped) to scale it.
  const token = await bountyToken(supabase, bountyId);
  if (!token) return fail("not_found");
  const units = parseAmount(amount, token);
  if (units === null || units <= 0n) return fail("invalid_input");
  const { data, error } = await supabase.rpc("create_bounty_payment_intent", {
    p_bounty: bountyId,
    p_amount: units.toString(),
    p_fee_bps: feeBps,
  });
  if (error) return fail(rpcErrorCode(error));
  if (!data) return fail("unknown");
  return { ok: true, intent: data as TipIntent };
}

async function bountyToken(supabase: Awaited<ReturnType<typeof createServerClient>>, bountyId: string): Promise<Token | null> {
  const { data } = await supabase.rpc("bounty_details", { p_message_ids: [bountyId] });
  const row = Array.isArray(data) ? (data[0] as { token?: unknown } | undefined) : undefined;
  return isToken(row?.token) ? row.token : null;
}
