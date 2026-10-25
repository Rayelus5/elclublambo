"use server";

import { appChainIds, isChainId } from "@/lib/economy/networks";
import { verifyClubSafe } from "@/lib/economy/club-safe";
import { getPublicSession } from "@/lib/auth/public-session";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/errors";
import { parseAmount } from "@/lib/payments/amounts";
import { confirmPublicDonation } from "@/lib/payments/confirm";
import type { TipIntent } from "@/lib/payments/tip-actions";
import { hitRateLimit } from "@/lib/rate-limit";
import { safeError } from "@/lib/security/redact";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

type Fail = { ok: false; error: string; code: string };
const fail = (code: string): Fail => ({ ok: false, code, error: rpcErrorMessage(code) });

export type PublicDonationInput = { chainId: number; token: "USDC" | "ETH"; amount: string; anonymous: boolean; listed: boolean };

export type PublicVerifyResult =
  | { status: "confirmed" }
  | { status: "pending"; reason?: "price_unavailable" | "safe_not_deployed" }
  | { status: "failed"; code: string; error: string };

/** Creates a public donation intent to the club Safe (requires a public account; the Safe must exist on that network). */
export async function createPublicDonationIntentAction(input: PublicDonationInput): Promise<{ ok: true; intent: TipIntent } | Fail> {
  const { chainId, token, amount, anonymous, listed } = input ?? ({} as PublicDonationInput);
  if (
    !isChainId(chainId) ||
    (token !== "ETH" && token !== "USDC") ||
    typeof amount !== "string" ||
    typeof anonymous !== "boolean" ||
    typeof listed !== "boolean"
  ) {
    return fail("invalid_input");
  }
  if (!appChainIds().includes(chainId)) return fail("chain_invalid");
  const units = parseAmount(amount, token);
  if (units === null || units <= 0n) return fail("invalid_input");

  const safe = await verifyClubSafe(chainId);
  if (safe === "not_deployed") return fail("safe_not_deployed");
  if (safe === "not_configured") return fail("safe_not_configured");
  if (safe === "network") return fail("rpc_unavailable");

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("create_public_donation_intent", {
    p_chain_id: chainId,
    p_token: token,
    p_amount: units.toString(),
    p_anonymous: anonymous,
    p_listed: listed,
  });
  if (error) return fail(rpcErrorCode(error));
  if (!data) return fail("unknown");
  return { ok: true, intent: data as TipIntent };
}

export async function attachPublicDonationTxAction(intentId: string, hash: string): Promise<{ ok: true } | Fail> {
  if (typeof intentId !== "string" || !UUID_RE.test(intentId) || typeof hash !== "string" || !HASH_RE.test(hash)) {
    return fail("invalid_input");
  }
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("attach_public_donation_tx", { p_intent: intentId, p_hash: hash.toLowerCase() });
  if (error) return fail(rpcErrorCode(error));
  return { ok: true };
}

/** Verifies the caller's own public donation on-chain and records it. A limited or failed charge stays pending. */
export async function verifyPublicDonationAction(intentId: string): Promise<PublicVerifyResult> {
  const bad = (code: string) => ({ status: "failed" as const, code, error: rpcErrorMessage(code) });
  if (typeof intentId !== "string" || !UUID_RE.test(intentId)) return bad("invalid_input");

  const session = await getPublicSession();
  if (!session) return bad("forbidden");

  // The intents table has no RLS read policy: ownership is checked here against the session's user id.
  const { data: own, error } = await createAdminClient().from("public_donation_intents").select("user_id").eq("id", intentId).maybeSingle<{ user_id: string }>();
  if (error) {
    console.error("[donations] public intent ownership read failed", intentId, safeError(error.message));
    return { status: "pending" };
  }
  if (!own || own.user_id !== session.userId) return bad("not_found");

  const supabase = await createServerClient();
  if ((await hitRateLimit(supabase, "chain_verify")) !== "ok") return { status: "pending" };

  const res = await confirmPublicDonation(intentId);
  if (res.status === "confirmed") return { status: "confirmed" };
  if (res.status === "pending") return res.reason ? { status: "pending", reason: res.reason } : { status: "pending" };
  return { status: "failed", code: res.code, error: res.error };
}
