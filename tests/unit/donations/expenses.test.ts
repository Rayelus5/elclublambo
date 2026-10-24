import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const SAFE = "0x380f2e12081995359e2Ab88E3c31c6b227904234";
const OTHER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const HASH = `0x${"AB".repeat(32)}`;

const treasurerId = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/treasurer", () => ({ treasurerId }));
const hitRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({ hitRateLimit }));
const verifyTransfer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/verify", () => ({ verifyTransfer, defaultConfirmations: () => 3 }));
const client = vi.hoisted(() => ({
  getChainId: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getTransaction: vi.fn(),
  getBlockNumber: vi.fn(),
}));
vi.mock("@/lib/payments/chain-client", () => ({ chainClient: () => client }));
const rpc = vi.hoisted(() => vi.fn());
const maybeSingle = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({}) }));

import { addExpenseAction } from "@/lib/donations/expenses";

const usdc = { chainId: 84532, token: "USDC" as const, amount: "12,5", txHash: HASH, note: "Servidor del mes" };
const eth = { ...usdc, token: "ETH" as const, amount: "0.01" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
  treasurerId.mockResolvedValue("m1");
  hitRateLimit.mockResolvedValue("ok");
  maybeSingle.mockResolvedValue({ data: { safe_address: SAFE }, error: null });
  verifyTransfer.mockResolvedValue({ status: "ok", logIndex: 4, value: 12_500_000n, blockNumber: 9n, blockTimestamp: new Date() });
  client.getChainId.mockResolvedValue(84532);
  client.getTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 100n });
  client.getBlockNumber.mockResolvedValue(110n);
  client.getTransaction.mockResolvedValue({ to: SAFE.toLowerCase(), chainId: 84532 });
  rpc.mockResolvedValue({ data: "e1", error: null });
});

describe("addExpenseAction", () => {
  it("is forbidden without MANAGE_TREASURY and touches nothing", async () => {
    treasurerId.mockResolvedValue(null);
    expect(await addExpenseAction(usdc)).toMatchObject({ ok: false, code: "forbidden" });
    expect(hitRateLimit).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("stops at the rate limit before any chain read", async () => {
    hitRateLimit.mockResolvedValue("rate_limited");
    expect(await addExpenseAction(usdc)).toMatchObject({ ok: false, code: "rate_limited" });
    expect(verifyTransfer).not.toHaveBeenCalled();
  });
  it.each([
    { ...usdc, chainId: 8453 },
    { ...usdc, token: "DAI" },
    { ...usdc, amount: "0" },
    { ...usdc, amount: "abc" },
    { ...usdc, txHash: "0x12" },
    { ...usdc, note: "   " },
    { ...usdc, note: "x".repeat(281) },
  ])("rejects invalid input %o", async (input) => {
    expect(await addExpenseAction(input as never)).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("verifies a USDC expense with to: null and records the log it found", async () => {
    expect(await addExpenseAction(usdc)).toEqual({ ok: true });
    expect(verifyTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ chain: 84532, token: "USDC", from: SAFE, to: null, amount: 12_500_000n, txHash: HASH.toLowerCase() }),
    );
    expect(rpc).toHaveBeenCalledWith("record_club_expense", {
      p_chain: 84532,
      p_token: "USDC",
      p_amount: "12500000",
      p_tx_hash: HASH.toLowerCase(),
      p_log_index: 4,
      p_note: "Servidor del mes",
      p_verified_kind: "usdc_log",
      p_actor: "m1",
    });
  });
  it("maps a verification error and records nothing", async () => {
    verifyTransfer.mockResolvedValue({ status: "error", code: "tx_mismatch" });
    expect(await addExpenseAction(usdc)).toMatchObject({ ok: false, code: "tx_mismatch" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("asks to retry while the transfer is pending", async () => {
    verifyTransfer.mockResolvedValue({ status: "pending" });
    expect(await addExpenseAction(usdc)).toMatchObject({ ok: false, code: "payout_pending" });
  });
  it("fails when the network has no Safe address", async () => {
    maybeSingle.mockResolvedValue({ data: { safe_address: null }, error: null });
    expect(await addExpenseAction(usdc)).toMatchObject({ ok: false, code: "safe_not_configured" });
  });
  it("records an ETH expense when the transaction went to the Safe (log index -1)", async () => {
    expect(await addExpenseAction(eth)).toEqual({ ok: true });
    expect(verifyTransfer).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("record_club_expense", expect.objectContaining({ p_token: "ETH", p_amount: "10000000000000000", p_log_index: -1, p_verified_kind: "safe_tx" }));
  });
  it("answers tx_mismatch for an ETH transaction to another address", async () => {
    client.getTransaction.mockResolvedValue({ to: OTHER, chainId: 84532 });
    expect(await addExpenseAction(eth)).toMatchObject({ ok: false, code: "tx_mismatch" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("answers tx_failed for a reverted ETH transaction and pending without confirmations", async () => {
    client.getTransactionReceipt.mockResolvedValue({ status: "reverted", blockNumber: 100n });
    expect(await addExpenseAction(eth)).toMatchObject({ ok: false, code: "tx_failed" });
    client.getTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 109n });
    expect(await addExpenseAction(eth)).toMatchObject({ ok: false, code: "payout_pending" });
  });
  it("answers tx_not_found when the node does not know the ETH transaction", async () => {
    client.getTransactionReceipt.mockRejectedValue(Object.assign(new Error("x"), { name: "TransactionReceiptNotFoundError" }));
    expect(await addExpenseAction(eth)).toMatchObject({ ok: false, code: "tx_not_found" });
  });
  it("maps the RPC error tx_already_used", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "tx_already_used" } });
    expect(await addExpenseAction(usdc)).toMatchObject({ ok: false, code: "tx_already_used" });
  });
});
