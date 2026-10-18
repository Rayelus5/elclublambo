import "server-only";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/errors";
import type { ChainId } from "@/lib/economy/networks";
import type { Token } from "@/lib/payments/amounts";
import { verifyTransfer, type VerifyResult } from "@/lib/payments/verify";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { settlePendingDonations } from "@/lib/treasury/settle";

export type ConfirmResult =
  | { status: "confirmed"; tipId: string; ledgerId?: undefined }
  /** A donation credited as shares (no tip exists). */
  | { status: "confirmed"; ledgerId: string; tipId?: undefined }
  | { status: "pending" }
  /** Donation recorded and verified; credited as shares once its block is finalized. */
  | { status: "pending_finality"; ledgerId: string }
  | { status: "failed"; error: string; code: string };

/** Errors that will never get better: the intent is failed for good. tx_not_found / rpc_unavailable are not here. */
const PERMANENT = new Set(["tx_mismatch", "tx_failed", "tx_too_old", "tx_already_used"]);
const MAX_REVERIFY = 5;
const LATE_CREDIT_DAYS = 7;

type IntentRow = {
  id: string;
  purpose?: "tip" | "bounty" | "donation";
  member_id: string;
  chain_id: number;
  token: Token;
  amount: string;
  fee_amount: string;
  recipient_address: string;
  platform_address: string | null;
  status: "pending" | "confirmed" | "failed" | "expired";
  failure_code: string | null;
  main_tx_hash: string | null;
  fee_tx_hash: string | null;
  created_at: string;
  expires_at: string;
};

// numeric(78,0) comes back as a JSON number (lossy above 2^53): cast to text in the select.
const INTENT_COLUMNS =
  "id, purpose, member_id, chain_id, token, amount:amount::text, fee_amount:fee_amount::text, recipient_address, platform_address, status, failure_code, main_tx_hash, fee_tx_hash, created_at, expires_at";

const failed = (code: string): ConfirmResult => ({ status: "failed", code, error: rpcErrorMessage(code) });

/** Required hashes are present: main always, fee only when a fee is charged. */
function hasRequiredHashes(i: Pick<IntentRow, "main_tx_hash" | "fee_tx_hash" | "fee_amount">): boolean {
  return !!i.main_tx_hash && (BigInt(i.fee_amount) === 0n || !!i.fee_tx_hash);
}

/**
 * Verifies the fee (if any) and then the main transfer on-chain and, only if both hold, credits the tip through the
 * service-role RPC confirm_tip. Idempotent: a confirmed intent returns its tip without touching the chain.
 * Callers must have authorised access to the intent already (this uses the admin client).
 */
export async function confirmIntent(intentId: string): Promise<ConfirmResult> {
  const db = createAdminClient();

  const { data: i } = await db.from("payment_intents").select(INTENT_COLUMNS).eq("id", intentId).maybeSingle<IntentRow>();
  if (!i) return failed("not_found");

  if (i.status === "confirmed" && i.purpose === "donation") {
    const { data: led } = await db.from("dao_ledger").select("id, status").eq("intent_id", i.id).maybeSingle<{ id: string; status: string }>();
    if (!led) return { status: "pending" };
    if (led.status === "credited") return { status: "confirmed", ledgerId: led.id };
    if (led.status === "reverted") return failed("reverted");
    return { status: "pending_finality", ledgerId: led.id };
  }
  if (i.status === "confirmed") {
    const { data: tip } = await db.from("tips").select("id").eq("intent_id", i.id).maybeSingle<{ id: string }>();
    return tip ? { status: "confirmed", tipId: tip.id } : { status: "pending" };
  }
  if (i.status === "failed") return failed(i.failure_code ?? "unknown");
  if (i.status === "expired") return failed("intent_expired");

  // Fail closed: only purposes with a known confirm RPC are credited; anything else is never verified nor credited.
  if (i.purpose !== "tip" && i.purpose !== "bounty" && i.purpose !== "donation") return failed("invalid_input");

  if (!hasRequiredHashes(i)) return { status: "pending" };

  const { data: payer } = await db.from("members").select("wallet_address").eq("id", i.member_id).maybeSingle<{ wallet_address: string }>();
  if (!payer) return failed("not_found");

  const fee = BigInt(i.fee_amount);
  const isDonation = i.purpose === "donation";
  // A donation is recorded once mined (1 confirmation): the finality gate in settlePendingDonations is what protects it.
  const base = {
    chain: i.chain_id as ChainId,
    token: i.token,
    from: payer.wallet_address,
    notBefore: new Date(i.created_at),
    ...(isDonation ? { confirmations: 1 } : {}),
  };

  const permanent = async (code: string): Promise<ConfirmResult> => {
    await db.rpc("fail_intent", { p_intent: i.id, p_code: code });
    return failed(code);
  };
  // pending / tx_not_found / rpc_unavailable leave the intent untouched; permanent errors fail it.
  const check = async (res: VerifyResult): Promise<ConfirmResult | null> => {
    if (res.status === "error" && PERMANENT.has(res.code)) return permanent(res.code);
    return res.status === "ok" ? null : { status: "pending" };
  };

  let feeOk: Extract<VerifyResult, { status: "ok" }> | null = null;
  if (fee > 0n) {
    if (!i.platform_address) return failed("platform_not_configured");
    const res = await verifyTransfer({ ...base, txHash: i.fee_tx_hash as `0x${string}`, to: i.platform_address, amount: fee });
    const stop = await check(res);
    if (stop) return stop;
    feeOk = res as Extract<VerifyResult, { status: "ok" }>;
  }

  const mainRes = await verifyTransfer({ ...base, txHash: i.main_tx_hash as `0x${string}`, to: i.recipient_address, amount: BigInt(i.amount) });
  const stop = await check(mainRes);
  if (stop) return stop;
  const main = mainRes as Extract<VerifyResult, { status: "ok" }>;

  if (isDonation) {
    const { data: ledgerId, error: recError } = await db.rpc("record_donation", {
      p_intent: i.id,
      p_main: { txHash: i.main_tx_hash, logIndex: main.logIndex, blockNumber: main.blockNumber.toString() },
      p_fee: feeOk ? { txHash: i.fee_tx_hash, logIndex: feeOk.logIndex, blockNumber: feeOk.blockNumber.toString() } : null,
    });
    if (recError || typeof ledgerId !== "string") {
      const code = recError ? rpcErrorCode(recError) : "unknown";
      if (PERMANENT.has(code) || code === "intent_expired") return permanent(code);
      console.error("[payments] record_donation failed", i.id, recError?.message);
      return { status: "pending" };
    }
    // Immediate settle attempt: credits at once only if the block is already final. Never undoes the recording.
    try {
      const s = await settlePendingDonations(i.chain_id as ChainId, { ledgerId, limit: 1 });
      if (s.credited > 0) return { status: "confirmed", ledgerId };
      if (s.reverted > 0) return failed("reverted");
    } catch (e) {
      console.error("[payments] settle after record failed", ledgerId, e);
    }
    return { status: "pending_finality", ledgerId };
  }

  // Only bounty confirms need the block time (it sets paid_at, ruling F3c-R4); confirm_tip keeps its signature.
  const isBounty = i.purpose === "bounty";
  const { data: tipId, error } = await db.rpc(isBounty ? "confirm_bounty_payment" : "confirm_tip", {
    p_intent: i.id,
    p_main: {
      txHash: i.main_tx_hash,
      logIndex: main.logIndex,
      blockNumber: main.blockNumber.toString(),
      ...(isBounty ? { blockTimestamp: main.blockTimestamp.toISOString() } : {}),
    },
    p_fee: feeOk ? { txHash: i.fee_tx_hash, logIndex: feeOk.logIndex, blockNumber: feeOk.blockNumber.toString() } : null,
  });
  if (error) {
    const code = rpcErrorCode(error);
    if (PERMANENT.has(code) || code === "intent_expired" || code === "already_paid") return permanent(code);
    console.error("[payments] confirm failed", i.id, error.message);
    return { status: "pending" };
  }
  return { status: "confirmed", tipId: tipId as string };
}

/**
 * Re-verifies a member's pending intents whose required hashes were attached (the tab may have closed after signing).
 * At most 5 per call; errors are logged and swallowed. Intents past their 24 h expiry are still tried within the
 * 7-day late-credit window (ruling F3b-R2): confirm_tip decides, using hashes_attached_at.
 */
export async function reverifyIntentsFor(memberId: string, confirm: (intentId: string) => Promise<unknown> = confirmIntent): Promise<void> {
  try {
    const since = new Date(Date.now() - LATE_CREDIT_DAYS * 24 * 3600 * 1000).toISOString();
    const { data } = await createAdminClient()
      .from("payment_intents")
      .select("id, fee_amount:fee_amount::text, main_tx_hash, fee_tx_hash")
      .eq("member_id", memberId)
      .eq("status", "pending")
      .in("purpose", ["tip", "bounty", "donation"])
      .not("main_tx_hash", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(20);
    const rows = ((data ?? []) as Pick<IntentRow, "id" | "fee_amount" | "main_tx_hash" | "fee_tx_hash">[]).filter(hasRequiredHashes);
    for (const row of rows.slice(0, MAX_REVERIFY)) {
      try {
        await confirm(row.id);
      } catch (e) {
        console.error("[payments] reverify failed", row.id, e);
      }
    }
  } catch (e) {
    console.error("[payments] reverify query failed", e);
  }
}

/** The caller's own pending intents (member id from the session unless the layout already resolved it). */
export async function reverifyMyPendingIntents(memberId?: string): Promise<void> {
  try {
    let id = memberId;
    if (!id) {
      const { data } = await (await createServerClient()).rpc("current_member_id");
      id = typeof data === "string" ? data : undefined;
    }
    if (id) await reverifyIntentsFor(id);
  } catch (e) {
    console.error("[payments] reverifyMyPendingIntents failed", e);
  }
}
