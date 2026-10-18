"use server";

import { revalidatePath } from "next/cache";
import { getEconomyConfig } from "@/lib/economy/config";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/errors";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import type { TipIntent } from "@/lib/payments/tip-actions";
import { createServerClient } from "@/lib/supabase/server";
import { reconcile } from "@/lib/treasury/reconcile";

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
export async function createDonationIntentAction(input: { amount: string; feeBps: number }): Promise<{ ok: true; intent: TipIntent } | Fail> {
  const { amount, feeBps } = input ?? ({} as { amount: string; feeBps: number });
  if (typeof amount !== "string" || !Number.isInteger(feeBps) || feeBps < 0 || feeBps > 5000) return fail("invalid_input");
  const units = parseUsdc(amount);
  if (units === null || units <= 0n) return fail("invalid_input");

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("create_donation_intent", { p_amount: units.toString(), p_fee_bps: feeBps });
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

export type ReconcileSummary = { chainId: number; ledgerValue: string; onchainBalance: string; diff: string; id: string };

/** "Reconciliar ahora": MANAGE_TREASURY (or admin) only, on the active chain. Amounts travel as text. */
export async function reconcileNowAction(): Promise<{ ok: true; result: ReconcileSummary } | Fail> {
  const supabase = await createServerClient();
  const [{ data: perms }, { data: memberId }] = await Promise.all([supabase.rpc("my_permissions"), supabase.rpc("current_member_id")]);
  if (typeof memberId !== "string" || !hasPerm(BigInt(String(perms ?? 0)), Perm.MANAGE_TREASURY)) return fail("forbidden");

  const { activeChainId } = await getEconomyConfig();
  try {
    const r = await reconcile(activeChainId, memberId);
    revalidatePath("/dao");
    return {
      ok: true,
      result: {
        chainId: activeChainId,
        ledgerValue: r.ledgerValue.toString(),
        onchainBalance: r.onchainBalance.toString(),
        diff: r.diff.toString(),
        id: r.id,
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message === "safe_not_configured") return fail("safe_not_configured");
    console.error("[treasury] reconcileNow failed", e);
    return fail("rpc_unavailable");
  }
}
