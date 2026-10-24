import "server-only";
import { safeError } from "@/lib/security/redact";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/errors";
import { appChainIds, isChainId } from "@/lib/economy/networks";
import { readEthUsd, usd6For } from "@/lib/economy/eth-price";
import type { Token } from "@/lib/payments/amounts";
import { verifyTransfer, type VerifyResult } from "@/lib/payments/verify";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export type ConfirmResult =
  | { status: "confirmed"; tipId: string; ledgerId?: undefined }
  /** A donation credited as shares (no tip exists). */
  | { status: "confirmed"; ledgerId: string; tipId?: undefined }
  /** A verified donation recorded in `donations` (P1). */
  | { status: "confirmed"; donationId: string; tipId?: undefined; ledgerId?: undefined }
  /** `reason` says what it waits for when that is not the chain itself (price_unavailable: ETH donation with no trusted price). */
  | { status: "pending"; reason?: "price_unavailable" }
  /** Donation recorded and verified; credited as shares once its block is finalized. */
  | { status: "pending_finality"; ledgerId: string }
  | { status: "failed"; error: string; code: string };

/** Verification errors that will never get better: the intent is failed for good. tx_not_found / rpc_unavailable are not here. */
const PERMANENT = new Set(["tx_mismatch", "tx_failed", "tx_too_old", "tx_already_used"]);
/**
 * Errors of the recording RPCs (confirm_tip, confirm_bounty_payment, confirm_donation) that will never get better. Their
 * inputs are derived deterministically from the intent and the chain, so invalid_input / not_found (a recheck the intent
 * can no longer pass) recur on every retry: failing the intent stops reverify from retrying it for 7 days.
 */
const PERMANENT_RECORD = new Set([...PERMANENT, "intent_expired", "already_paid", "invalid_input", "not_found"]);
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

  // F3-R3: a read ERROR is transient (pending); only a read that succeeded with no row is a definitive not_found.
  const { data: i, error: readError } = await db.from("payment_intents").select(INTENT_COLUMNS).eq("id", intentId).maybeSingle<IntentRow>();
  if (readError) {
    console.error("[payments] intent read failed", intentId, safeError(readError.message));
    return { status: "pending" };
  }
  if (!i) return failed("not_found");

  // Fails the intent for good. If that write fails, the intent stays pending and the caller is told so (never failed).
  const permanent = async (code: string): Promise<ConfirmResult> => {
    const { error } = await db.rpc("fail_intent", { p_intent: i.id, p_code: code });
    if (error) {
      console.error("[payments] fail_intent failed", i.id, code, safeError(error.message));
      return { status: "pending" };
    }
    return failed(code);
  };

  if (i.status === "confirmed" && i.purpose === "donation") {
    const { data: don, error: donError } = await db.from("donations").select("id").eq("intent_id", i.id).maybeSingle<{ id: string }>();
    if (donError) console.error("[payments] donation read failed", i.id, safeError(donError.message));
    return don ? { status: "confirmed", donationId: don.id } : { status: "pending" };
  }
  if (i.status === "confirmed") {
    const { data: tip, error: tipError } = await db.from("tips").select("id").eq("intent_id", i.id).maybeSingle<{ id: string }>();
    if (tipError) console.error("[payments] tip read failed", i.id, safeError(tipError.message));
    return tip ? { status: "confirmed", tipId: tip.id } : { status: "pending" };
  }
  if (i.status === "failed") return failed(i.failure_code ?? "unknown");
  if (i.status === "expired") return failed("intent_expired");

  // Fail closed: only purposes with a known confirm RPC are credited; anything else is never verified nor credited
  // (and failed for good: no retry can make it pass).
  if (i.purpose !== "tip" && i.purpose !== "bounty" && i.purpose !== "donation") return permanent("invalid_input");

  // Review Focus 4 / P0-R14: a legacy-chain leftover, or a network outside this build's set (the DB enables all four, and the
  // RPC can be called without the server action), is failed for good before anything asks for a chain client.
  const chain = i.chain_id;
  if (!isChainId(chain) || !appChainIds().includes(chain)) return permanent("chain_disabled");

  if (!hasRequiredHashes(i)) return { status: "pending" };

  const { data: payer, error: payerError } = await db.from("members").select("wallet_address").eq("id", i.member_id).maybeSingle<{ wallet_address: string }>();
  if (payerError) {
    console.error("[payments] payer read failed", i.id, safeError(payerError.message));
    return { status: "pending" };
  }
  if (!payer) return failed("not_found");

  const fee = BigInt(i.fee_amount);
  const isDonation = i.purpose === "donation";
  const base = {
    chain,
    token: i.token,
    from: payer.wallet_address,
    notBefore: new Date(i.created_at),
  };

  // pending / tx_not_found / rpc_unavailable leave the intent untouched; permanent errors fail it.
  const check = async (res: VerifyResult): Promise<ConfirmResult | null> => {
    if (res.status === "error" && PERMANENT.has(res.code)) return permanent(res.code);
    return res.status === "ok" ? null : { status: "pending" };
  };

  let feeOk: Extract<VerifyResult, { status: "ok" }> | null = null;
  if (fee > 0n) {
    if (!i.platform_address) return permanent("platform_not_configured");
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
    // ETH is valued by Chainlink only; with no trusted price it stays pending (never credited, never failed).
    let priceE8: bigint | null = null;
    if (i.token === "ETH") {
      const price = await readEthUsd(chain);
      if (!price) return { status: "pending", reason: "price_unavailable" };
      priceE8 = price.priceE8;
    }
    const usd6 = usd6For(i.token, BigInt(i.amount), priceE8);
    if (usd6 === null) return { status: "pending", reason: "price_unavailable" };
    const { data, error: donError } = await db.rpc("confirm_donation", {
      p_intent: i.id,
      p_main: { txHash: i.main_tx_hash, logIndex: main.logIndex, blockNumber: main.blockNumber.toString() },
      p_usd6: usd6.toString(),
      p_eth_price_e8: priceE8 === null ? null : priceE8.toString(),
    });
    const donationId = (data as { donationId?: unknown } | null)?.donationId;
    if (donError || typeof donationId !== "string") {
      const code = donError ? rpcErrorCode(donError) : "unknown";
      if (PERMANENT_RECORD.has(code)) return permanent(code);
      console.error("[payments] confirm_donation failed", i.id, safeError(donError?.message));
      return { status: "pending" };
    }
    return { status: "confirmed", donationId };
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
    if (PERMANENT_RECORD.has(code)) return permanent(code);
    console.error("[payments] confirm failed", i.id, safeError(error.message));
    return { status: "pending" };
  }
  return { status: "confirmed", tipId: tipId as string };
}

/**
 * Re-verifies a member's pending intents whose required hashes were attached (the tab may have closed after signing).
 * At most 5 per call, newest first: an old intent that never resolves (a dropped or replaced transaction) cannot starve
 * a newer real payment, and rechecks that can never pass are failed for good by confirmIntent. Errors are logged and
 * swallowed. Intents past their 24 h expiry are still tried within the
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
      .order("created_at", { ascending: false })
      .limit(20);
    const rows = ((data ?? []) as Pick<IntentRow, "id" | "fee_amount" | "main_tx_hash" | "fee_tx_hash">[]).filter(hasRequiredHashes);
    for (const row of rows.slice(0, MAX_REVERIFY)) {
      try {
        await confirm(row.id);
      } catch (e) {
        console.error("[payments] reverify failed", row.id, safeError(e));
      }
    }
  } catch (e) {
    console.error("[payments] reverify query failed", safeError(e));
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
    console.error("[payments] reverifyMyPendingIntents failed", safeError(e));
  }
}
