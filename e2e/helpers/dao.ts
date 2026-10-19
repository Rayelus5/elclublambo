import { createPublicClient, createWalletClient, erc20Abi, http, type Abi } from "viem";
import { expect, type Locator, type Page } from "@playwright/test";
import { CHAIN_ID, RPC_URL, USDC_ADDRESS } from "../chain/shared.mjs";
import { service } from "./f2c";

// Shared by the DAO specs (f3d, f4a): local-chain moves outside the app, the cron, and snapshot timing control.
// TEST-ONLY: every account is a Hardhat default account, unlocked on the local node.

export const CRON_SECRET = "e2e-cron-secret";

/** Exact copy of the donation dialog's mandatory acknowledgement (F4a). */
export const DONATION_ACK =
  "Entiendo que es una donación sin esperar nada a cambio, que el fondo se invierte con riesgo y que las retiradas dependen de la disponibilidad y de la decisión del tesorero.";

export const localChain = {
  id: CHAIN_ID,
  name: "Local Linea Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;

const publicClient = () => createPublicClient({ chain: localChain, transport: http(RPC_URL) });

/** Raw JSON-RPC call to the local Hardhat node (hardhat_* / evm_* methods). */
export async function hardhatRpc(method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

/** Mines one empty block: the operations scan stops at latest − TIP_CONFIRMATIONS (1), so the last tx needs one on top. */
export const mineBlock = () => hardhatRpc("evm_mine");

/** ERC-20 balance of a token (default: the local USDC) for an address. */
export async function tokenBalance(address: string, token: `0x${string}` = USDC_ADDRESS): Promise<bigint> {
  return publicClient().readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] });
}

/** Sends a contract call from an account the node signs for (a Hardhat account or an impersonated one) and waits for it. */
export async function sendCall(
  from: string,
  to: `0x${string}`,
  abi: Abi,
  functionName: string,
  args: unknown[],
  value?: bigint,
): Promise<`0x${string}`> {
  const wallet = createWalletClient({ account: from as `0x${string}`, chain: localChain, transport: http(RPC_URL) });
  const hash = await wallet.writeContract({ address: to, abi, functionName, args, value } as Parameters<typeof wallet.writeContract>[0]);
  const receipt = await publicClient().waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
  return hash;
}

/** Sends token units (default USDC) from `from` straight to `to`, bypassing the app entirely. Returns the tx hash. */
export async function sendToken(from: string, to: string, units: bigint, token: `0x${string}` = USDC_ADDRESS): Promise<`0x${string}`> {
  return sendCall(from, token, erc20Abi, "transfer", [to, units]);
}

/**
 * A token transfer (default USDC) made by the Safe itself (as a treasurer would from the Safe app): the Safe is
 * impersonated and gets a temporary native balance for gas, removed again afterwards so the fund never holds ETH.
 * Returns the tx hash.
 */
export async function safeTransfer(safe: string, to: string, units: bigint, token: `0x${string}` = USDC_ADDRESS): Promise<`0x${string}`> {
  await hardhatRpc("hardhat_setBalance", [safe, "0xde0b6b3a7640000"]);
  await hardhatRpc("hardhat_impersonateAccount", [safe]);
  try {
    return await sendToken(safe, to, units, token);
  } finally {
    await hardhatRpc("hardhat_stopImpersonatingAccount", [safe]);
    await hardhatRpc("hardhat_setBalance", [safe, "0x0"]);
  }
}

/**
 * Moves a withdrawal's approval `days` into the past (service role), so the next cron run sees it lapsed: the expiry
 * needs approved_at + 14 days + 120 s to be before the block time the scan reached (ruling F4c-R5). No wall-clock wait.
 */
export async function ageApproval(requestId: string, days: number) {
  const db = service();
  const row = await db.from("withdrawal_requests").select("approved_at").eq("id", requestId).single<{ approved_at: string | null }>();
  expect(row.error).toBeNull();
  expect(row.data!.approved_at).not.toBeNull();
  const older = new Date(Date.parse(row.data!.approved_at!) - days * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await db.from("withdrawal_requests").update({ approved_at: older }).eq("id", requestId);
  expect(error).toBeNull();
}

/**
 * Moves a raffle's close `closesAgoSeconds` into the past (service role), so the next cron run closes it (F4d): the
 * weights are taken then, and the draw uses the first block after this close once it is finalized (Hardhat: finalized
 * = latest, so mine a block or two on top). Joining is refused from then on. No wall-clock wait.
 */
export async function ageRaffle(raffleId: string, closesAgoSeconds: number) {
  const closesAt = new Date(Date.now() - closesAgoSeconds * 1000).toISOString();
  const { error } = await service().from("raffles").update({ closes_at: closesAt }).eq("id", raffleId);
  expect(error).toBeNull();
}

/** Moves a drawn raffle's drawn_at `days` into the past (service role): past 14 days the prize counts as unpaid (F4d). */
export async function ageDraw(raffleId: string, days: number) {
  const db = service();
  const row = await db.from("raffles").select("drawn_at").eq("id", raffleId).single<{ drawn_at: string | null }>();
  expect(row.error).toBeNull();
  expect(row.data!.drawn_at).not.toBeNull();
  const older = new Date(Date.parse(row.data!.drawn_at!) - days * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await db.from("raffles").update({ drawn_at: older }).eq("id", raffleId);
  expect(error).toBeNull();
}

/**
 * Gives a member `shares` participaciones (18 decimals) on the local chain, `locked` of them locked, and adds them to
 * dao_state.total_shares (service role, F4e). A position with no ledger behind it: enough for a weighted poll's snapshot,
 * which reads only dao_positions; resetLocalDao clears it again.
 */
export async function seedPosition(memberId: string, shares: bigint, locked = 0n) {
  const db = service();
  const pos = await db
    .from("dao_positions")
    .upsert({ chain_id: CHAIN_ID, member_id: memberId, shares: shares.toString(), locked_shares: locked.toString() }, { onConflict: "chain_id,member_id" });
  expect(pos.error).toBeNull();
  const state = await db.from("dao_state").select("total_shares::text").eq("chain_id", CHAIN_ID).single<{ total_shares: string }>();
  expect(state.error).toBeNull();
  const total = BigInt(state.data!.total_shares) + shares;
  const upd = await db.from("dao_state").update({ total_shares: total.toString() }).eq("chain_id", CHAIN_ID);
  expect(upd.error).toBeNull();
}

/** Moves a poll's close `closedSecondsAgo` into the past (service role, F4e): it reads as closed at once, and the next cron run finalizes it. */
export async function agePoll(messageId: string, closedSecondsAgo: number) {
  const closesAt = new Date(Date.now() - closedSecondsAgo * 1000).toISOString();
  const { data, error } = await service().from("polls").update({ closes_at: closesAt }).eq("message_id", messageId).select("message_id");
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
}

export type CronChain = {
  chainId: number;
  snapshot?: "taken" | "skipped" | "unavailable" | "failed";
  scan?: { inserted: number; alerts: number } | null | "failed" | "scan_gap";
  payouts?: { recorded: number; paid: number; reverted: number; awaitingFinality: number } | "failed";
  credited?: number;
  pending?: number;
  skipped?: string;
  error?: string;
  /** F4c-R5: per chain; "skipped" when the scan failed this run. */
  expiredApprovals?: number | "failed" | "skipped";
  /** F4d: close + draw, prize payout detection and finality, unpaid notices. */
  raffles?:
    | { closed: number; voided: number; drawn: number; pending: number; recorded: number; paid: number; reverted: number; unpaidNotices: number;
        awaitingFinality: number; refusedDraws: { raffleId: string; code: string }[]; failed: string[] }
    | "failed";
};

/** Snapshot + operations scan + settlement, as the scheduler would call it. Returns the local chain's report. */
export async function runCron(method: "POST" | "GET" = "POST"): Promise<CronChain> {
  const res = await fetch("http://localhost:3000/api/cron/dao", { method, headers: { authorization: `Bearer ${CRON_SECRET}` } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { chains: CronChain[] };
  const chain = body.chains.find((c) => c.chainId === CHAIN_ID);
  expect(chain).toBeDefined();
  return chain!;
}

/**
 * Makes the next cron run take a snapshot now: snapshots are throttled to one per 55 minutes (record_nav_snapshot), so
 * the local chain's existing snapshots are moved one hour into the past. Deterministic, never waits on wall time.
 */
export async function ageSnapshots() {
  const db = service();
  const { data, error } = await db.from("dao_nav_snapshots").select("id, taken_at").eq("chain_id", CHAIN_ID);
  expect(error).toBeNull();
  for (const row of (data ?? []) as { id: string; taken_at: string }[]) {
    const older = new Date(Date.parse(row.taken_at) - 60 * 60 * 1000).toISOString();
    const { error: e } = await db.from("dao_nav_snapshots").update({ taken_at: older }).eq("id", row.id);
    expect(e).toBeNull();
  }
}

/**
 * Starts the local chain's DAO from zero, so each DAO spec is independent of order and reruns: other specs leave shares,
 * snapshots, scan cursors and treasury alerts on chain 59141. The DAO specs call it before AND after themselves, so a run
 * leaves 59141 clean (no Hardhat-era cursor, snapshots or shares under a later real Safe) and a later Safe change is not
 * refused by set_chain_addresses (F4a-R12: shares, pending donations or open donation intents block it).
 * Service role, test setup only; never touches 59144.
 */
export async function resetLocalDao() {
  const db = service();
  // withdrawal_requests and raffles right after dao_safe_operations (an outflow may link to a request or a raffle);
  // deleting a raffle cascades to its entries and to its secret seed (private.raffle_seeds, FK on delete cascade: no
  // API role ever touches that schema); deleting the positions also clears their locked_shares.
  for (const table of ["dao_safe_operations", "withdrawal_requests", "raffles", "dao_scan_state", "dao_nav_snapshots", "dao_positions", "dao_ledger"]) {
    const { error } = await db.from(table).delete().eq("chain_id", CHAIN_ID);
    expect(error, table).toBeNull();
  }
  const { error } = await db
    .from("dao_state")
    .update({ total_shares: 0, club_shares: 0, approved_locked_shares: 0, value_usdc: 0, nav_initialized: false, nav_at: null })
    .eq("chain_id", CHAIN_ID);
  expect(error).toBeNull();
  // The withdrawals switch starts off on the local chain (F4c), as on a fresh install.
  // Weighted raffles start on for the local chain, as the F4d migration sets them.
  const sw = await db.from("chain_config").update({ withdrawals_enabled: false, weighted_raffles_enabled: true }).eq("chain_id", CHAIN_ID);
  expect(sw.error).toBeNull();
  // Open donation intents to the spec's Safe would block the next Safe change (F4a-R12).
  const intents = await db
    .from("payment_intents")
    .update({ status: "expired" })
    .eq("chain_id", CHAIN_ID)
    .eq("purpose", "donation")
    .eq("status", "pending");
  expect(intents.error).toBeNull();
  const notices = await db.from("notifications").delete().in("kind", [
    "treasury_outflow",
    "withdrawal_approved",
    "withdrawal_rejected",
    "withdrawal_paid",
    "withdrawal_expired",
    "treasury_notice",
    "raffle_won",
    "poll_closed",
  ]);
  expect(notices.error).toBeNull();
}

/** Ticks the donation dialog's mandatory acknowledgement ("Continuar" stays disabled until then). */
export async function acknowledgeDonation(dialog: Locator) {
  const box = dialog.getByRole("checkbox", { name: DONATION_ACK });
  await box.click();
  await expect(box).toBeChecked();
}

/** The admin's notifications of one kind (service role: an assertion on rows, not on the UI). */
export async function noticesOf(recipientId: string, kind: string): Promise<number> {
  const { data, error } = await service().from("notifications").select("id").eq("kind", kind).eq("recipient_id", recipientId);
  expect(error).toBeNull();
  return data?.length ?? 0;
}

/** The operations list of /dao (members see outflows and noted inflows; treasurers also un-noted inflows). */
export const operationsList = (page: Page) => page.getByRole("list", { name: "Operaciones de la Safe" });
