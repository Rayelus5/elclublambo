"use server";

import { clubPath } from "@/lib/club/paths";
import { revalidatePath } from "next/cache";
import { verifyClubSafe } from "@/lib/economy/club-safe";
import { appChainIds, isChainId } from "@/lib/economy/networks";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/errors";
import { parseAmount } from "@/lib/payments/amounts";
import type { TipIntent } from "@/lib/payments/tip-actions";
import { createServerClient } from "@/lib/supabase/server";

type Fail = { ok: false; error: string; code: string };
const fail = (code: string): Fail => ({ ok: false, code, error: rpcErrorMessage(code) });

export type DonationInput = { chainId: number; token: "USDC" | "ETH"; amount: string; anonymous: boolean };

/**
 * Creates a donation intent to the club Safe. The Safe must exist on that network (P1-R6): checked here, with the
 * server's own RPC, so a tampered client cannot get an intent for an undeployed Safe.
 */
export async function createDonationIntentAction(input: DonationInput): Promise<{ ok: true; intent: TipIntent } | Fail> {
  const { chainId, token, amount, anonymous } = input ?? ({} as DonationInput);
  if (!isChainId(chainId) || (token !== "ETH" && token !== "USDC") || typeof amount !== "string" || typeof anonymous !== "boolean") {
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
  const { data, error } = await supabase.rpc("create_donation_intent", {
    p_chain_id: chainId,
    p_token: token,
    p_amount: units.toString(),
    p_anonymous: anonymous,
  });
  if (error) return fail(rpcErrorCode(error));
  if (!data) return fail("unknown");
  return { ok: true, intent: data as TipIntent };
}

export async function setDonorVisibleAction(visible: boolean): Promise<{ ok: true } | Fail> {
  if (typeof visible !== "boolean") return fail("invalid_input");
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_donor_visible", { p_visible: visible });
  if (error) return fail(rpcErrorCode(error));
  revalidatePath("/donar");
  revalidatePath(clubPath("/donar"));
  return { ok: true };
}
