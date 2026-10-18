"use server";

import { revalidatePath } from "next/cache";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/errors";
import type { TipIntent } from "@/lib/payments/tip-actions";
import { createServerClient } from "@/lib/supabase/server";

type Fail = { ok: false; error: string; code: string };
const fail = (code: string): Fail => ({ ok: false, code, error: rpcErrorMessage(code) });

const USDC_DECIMALS = 6;

/** "12,5" / "12.5" / "12" -> base units of USDC, or null when malformed. Bounds are enforced by the RPC. */
function parseUsdc(text: string): bigint | null {
  const m = /^(\d{1,13})(?:[.,](\d{1,6}))?$/.exec(text.trim());
  if (!m) return null;
  return BigInt(m[1]!) * 10n ** BigInt(USDC_DECIMALS) + BigInt((m[2] ?? "").padEnd(USDC_DECIMALS, "0") || "0");
}

/** Creates a donation intent on the active chain's Safe. Amount is typed USDC text; the RPC enforces 1..1000000. */
export async function createDonationIntentAction(input: { amount: string; feeBps: number; acknowledged: true }): Promise<{ ok: true; intent: TipIntent } | Fail> {
  const { amount, feeBps, acknowledged } = input ?? ({} as { amount: string; feeBps: number; acknowledged: unknown });
  // F4a-R8/R11: the risk acknowledgement is refused early here, and the RPC refuses it again (it is granted to members).
  if (acknowledged !== true) return fail("acknowledgement_required");
  if (typeof amount !== "string" || !Number.isInteger(feeBps) || feeBps < 0 || feeBps > 5000) return fail("invalid_input");
  const units = parseUsdc(amount);
  if (units === null || units <= 0n) return fail("invalid_input");

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("create_donation_intent", {
    p_amount: units.toString(),
    p_fee_bps: feeBps,
    p_acknowledged: acknowledged,
  });
  if (error) return fail(rpcErrorCode(error));
  if (!data) return fail("unknown");
  return { ok: true, intent: data as TipIntent };
}

export async function setRankingVisibleAction(visible: boolean): Promise<{ ok: true } | Fail> {
  if (typeof visible !== "boolean") return fail("invalid_input");
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_dao_ranking_visible", { p_visible: visible });
  if (error) return fail(rpcErrorCode(error));
  revalidatePath("/dao");
  revalidatePath("/perfil");
  return { ok: true };
}
