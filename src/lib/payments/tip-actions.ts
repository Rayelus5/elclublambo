"use server";

import { safeError } from "@/lib/security/redact";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/errors";
import { parseAmount, type Token } from "@/lib/payments/amounts";
import { confirmIntent, type ConfirmResult } from "@/lib/payments/confirm";
import { hitRateLimit } from "@/lib/rate-limit";
import { createServerClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export type TipIntent = {
  id: string;
  chainId: number;
  token: Token;
  amount: string;
  feeAmount: string;
  recipientAddress: string;
  platformAddress: string | null;
  expiresAt: string;
};

export type TipInput = {
  targetType: "message" | "profile";
  targetId: string;
  token: Token;
  amount: string;
  feeBps: number;
  anonymous: boolean;
};

type Fail = { ok: false; error: string; code: string };
const fail = (code: string): Fail => ({ ok: false, code, error: rpcErrorMessage(code) });

export async function createTipIntentAction(input: TipInput): Promise<{ ok: true; intent: TipIntent } | Fail> {
  const { targetType, targetId, token, amount, feeBps, anonymous } = input ?? ({} as TipInput);
  if (
    (targetType !== "message" && targetType !== "profile") ||
    typeof targetId !== "string" || !UUID_RE.test(targetId) ||
    (token !== "ETH" && token !== "USDC") ||
    typeof amount !== "string" ||
    !Number.isInteger(feeBps) || feeBps < 0 || feeBps > 5000 ||
    typeof anonymous !== "boolean"
  ) {
    return fail("invalid_input");
  }
  const units = parseAmount(amount, token);
  if (units === null || units <= 0n) return fail("invalid_input");

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("create_tip_intent", {
    p_target_type: targetType,
    p_target_id: targetId,
    p_token: token,
    p_amount: units.toString(),
    p_fee_bps: feeBps,
    p_anonymous: anonymous,
  });
  if (error) return fail(rpcErrorCode(error));
  if (!data) return fail("unknown");
  return { ok: true, intent: data as TipIntent };
}

export async function attachTxAction(intentId: string, role: "main" | "fee", txHash: string): Promise<{ ok: true } | Fail> {
  if (typeof intentId !== "string" || !UUID_RE.test(intentId) || (role !== "main" && role !== "fee") || typeof txHash !== "string" || !HASH_RE.test(txHash)) {
    return fail("invalid_input");
  }
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("attach_intent_tx", { p_intent: intentId, p_role: role, p_tx_hash: txHash.toLowerCase() });
  if (error) return fail(rpcErrorCode(error));
  return { ok: true };
}

export async function verifyIntentAction(
  intentId: string,
): Promise<ConfirmResult> {
  const bad = (code: string) => ({ status: "failed" as const, code, error: rpcErrorMessage(code) });
  if (typeof intentId !== "string" || !UUID_RE.test(intentId)) return bad("invalid_input");

  // RLS only returns the caller's own intents: this is the ownership check before the service-role confirmation.
  const supabase = await createServerClient();
  // F3-R3: a read error is transient (pending); not_found only when the read succeeded with no row.
  const { data: own, error } = await supabase.from("payment_intents").select("id").eq("id", intentId).maybeSingle<{ id: string }>();
  if (error) {
    console.error("[payments] intent ownership read failed", intentId, safeError(error.message));
    return { status: "pending" };
  }
  if (!own) return bad("not_found");

  // F5-R2 chain_verify pre-hit (its own transaction) before any RPC read. A limited or failed charge stays pending, never
  // failed: the dialog keeps waiting and the cron settles the intent later (Review Focus 1).
  if ((await hitRateLimit(supabase, "chain_verify")) !== "ok") return { status: "pending" };

  return confirmIntent(intentId);
}
