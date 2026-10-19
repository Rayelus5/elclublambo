import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const serverRpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc: serverRpc }) }));

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

const adminRpc = vi.hoisted(() => vi.fn());
const tables = vi.hoisted(() => ({}) as Record<string, unknown>);
const tableErrors = vi.hoisted(() => ({}) as Record<string, { message: string }>);
const createAdminClient = vi.hoisted(() =>
  vi.fn(() => ({
    rpc: adminRpc,
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) b[m] = () => b;
      b.maybeSingle = async () => (tableErrors[table] ? { data: null, error: tableErrors[table] } : { data: tables[table] ?? null, error: null });
      return b;
    },
  })),
);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

const valueSafe = vi.hoisted(() => vi.fn());
const safeAddressOf = vi.hoisted(() => vi.fn());
const valuationCap = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/snapshot", () => ({ valueSafe, safeAddressOf, valuationCap }));

const scanSafeOperations = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/scan", () => ({ scanSafeOperations }));

const verifyPayout = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/payouts", async (importOriginal) => ({ ...(await importOriginal<object>()), verifyPayout }));

import {
  approveWithdrawalAction,
  cancelWithdrawalAction,
  markWithdrawalPaidAction,
  quoteWithdrawalAction,
  rejectWithdrawalAction,
  requestWithdrawalAction,
  setWithdrawalsEnabledAction,
} from "@/lib/treasury/withdrawal-actions";

const ID = "6f1c1d3e-2b4a-4c5d-8e9f-0a1b2c3d4e5f";
const ME = "11111111-2222-4333-8444-555555555555";
const MEMBER = "99999999-8888-4777-8666-555555555555";
const SAFE = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const DEST = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const HASH = `0x${"ab".repeat(32)}`;
const valuation = (block: bigint, usdc = 30_000000n) => ({
  assetsUsd6: 40_000000n, priceE8: 250_000_000_000n, source: "chainlink", assets: { usdc, eth: 0n, weth: 0n, blockNumber: block }, blockNumber: block, safe: SAFE,
});

let perms = "256";
type Reply = { data?: unknown; error?: { message: string } | null };
let adminReplies: Record<string, Reply | Reply[]> = {};
const adminCalls = (name: string) => adminRpc.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

beforeEach(() => {
  vi.clearAllMocks();
  perms = "256";
  adminReplies = {};
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(tableErrors)) delete tableErrors[k];
  tables.withdrawal_requests = {
    chain_id: 59141, member_id: MEMBER, status: "approved", destination_address: DEST, amount_usdc_locked: "8000000",
    approved_at: "2026-10-19T10:00:00.000Z", last_expired_at: null,
  };
  tables.members = { wallet_address: DEST };
  serverRpc.mockImplementation(async (name: string) => {
    if (name === "my_permissions") return { data: perms, error: null };
    if (name === "current_member_id") return { data: ME, error: null };
    return { data: null, error: null };
  });
  adminRpc.mockImplementation(async (name: string) => {
    const r = adminReplies[name];
    const v = Array.isArray(r) ? r.shift() : r;
    return { data: v?.data ?? null, error: v?.error ?? null };
  });
  valueSafe.mockResolvedValue(valuation(120n));
  safeAddressOf.mockResolvedValue(SAFE);
  valuationCap.mockResolvedValue({ capped: false, block: null });
  scanSafeOperations.mockResolvedValue({ inserted: 0, alerts: 0 });
  verifyPayout.mockResolvedValue({ status: "ok", logIndex: 2, value: 8_000000n, blockNumber: 130n, blockTimestamp: new Date("2026-10-19T10:05:00.000Z") });
});

const revalidatedBoth = () => {
  expect(revalidatePath).toHaveBeenCalledWith("/dao");
  expect(revalidatePath).toHaveBeenCalledWith("/dao/tesoreria");
};

describe("treasurer gate", () => {
  it.each([
    ["quote", () => quoteWithdrawalAction(ID)],
    ["approve", () => approveWithdrawalAction(ID)],
    ["mark paid", () => markWithdrawalPaidAction(ID, HASH)],
  ])("%s: a non-treasurer gets forbidden and no admin client is created", async (_n, run) => {
    perms = "2";
    const r = await run();
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(valueSafe).not.toHaveBeenCalled();
  });

  it("ADMINISTRATOR (512) passes the gate", async () => {
    perms = "512";
    adminReplies.quote_withdrawal = { data: { amountUsdc: "8000000", reservedUsdc: "0" } };
    expect(await quoteWithdrawalAction(ID)).toMatchObject({ ok: true });
  });
});

describe("quoteWithdrawalAction", () => {
  it("quotes at the request's chain with a fresh valuation and computes the available USDC", async () => {
    adminReplies.quote_withdrawal = { data: { amountUsdc: "8000000", navUsd6: "1", supplyShares: "1", reservedUsdc: "25000000" } };
    const r = await quoteWithdrawalAction(ID);
    expect(valueSafe).toHaveBeenCalledWith(59141);
    expect(adminCalls("quote_withdrawal")).toEqual([{ p_request: ID, p_safe: SAFE, p_assets_usd6: "40000000", p_assets_block: "120", p_eth_price_e8: "250000000000" }]);
    expect(r).toEqual({
      ok: true,
      quote: { amountUsdc: "8000000", safeUsdc: "30000000", availableUsdc: "5000000", destination: DEST, selfApproval: false },
    });
    revalidatedBoth();
  });

  it("availableUsdc never goes below zero; selfApproval when the treasurer is the member", async () => {
    tables.withdrawal_requests = { ...(tables.withdrawal_requests as object), member_id: ME };
    adminReplies.quote_withdrawal = { data: { amountUsdc: "8000000", reservedUsdc: "31000000" } };
    expect(await quoteWithdrawalAction(ID)).toMatchObject({ ok: true, quote: { availableUsdc: "0", selfApproval: true } });
  });

  it("valueSafe returning null gives valuation_unavailable without calling the RPC", async () => {
    valueSafe.mockResolvedValue(null);
    const r = await quoteWithdrawalAction(ID);
    expect(r).toMatchObject({ ok: false, code: "valuation_unavailable" });
    if (!r.ok) expect(r.error).toMatch(/valorar el fondo/);
    expect(adminCalls("quote_withdrawal")).toEqual([]);
  });

  it("retries assets_stale exactly once with a fresh valuation", async () => {
    valueSafe.mockResolvedValueOnce(valuation(120n)).mockResolvedValueOnce(valuation(125n));
    adminReplies.quote_withdrawal = [{ error: { message: "assets_stale" } }, { data: { amountUsdc: "1", reservedUsdc: "0" } }];
    expect(await quoteWithdrawalAction(ID)).toMatchObject({ ok: true });
    expect(valueSafe).toHaveBeenCalledTimes(2);
    expect(adminCalls("quote_withdrawal").map((c) => (c as { p_assets_block: string }).p_assets_block)).toEqual(["120", "125"]);
  });

  it("a second assets_stale is returned", async () => {
    adminReplies.quote_withdrawal = [{ error: { message: "assets_stale" } }, { error: { message: "assets_stale" } }, { data: {} }];
    expect(await quoteWithdrawalAction(ID)).toMatchObject({ ok: false, code: "assets_stale" });
    expect(adminCalls("quote_withdrawal")).toHaveLength(2);
  });

  it("minor 3: a request read error is a Fail (unknown), not a throw", async () => {
    tableErrors.withdrawal_requests = { message: "db down" };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await quoteWithdrawalAction(ID)).toMatchObject({ ok: false, code: "unknown" });
    expect(await approveWithdrawalAction(ID)).toMatchObject({ ok: false, code: "unknown" });
    expect(await markWithdrawalPaidAction(ID, HASH)).toMatchObject({ ok: false, code: "unknown" });
    err.mockRestore();
  });

  it("minor 3: a members read error or a missing wallet is a Fail, never an empty destination", async () => {
    adminReplies.quote_withdrawal = { data: { amountUsdc: "1", reservedUsdc: "0" } };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    tableErrors.members = { message: "db down" };
    expect(await quoteWithdrawalAction(ID)).toMatchObject({ ok: false, code: "unknown" });
    delete tableErrors.members;
    delete tables.members;
    expect(await quoteWithdrawalAction(ID)).toMatchObject({ ok: false, code: "unknown" });
    err.mockRestore();
  });

  it("minor 4: a malformed reservedUsdc is a Fail, not a BigInt throw", async () => {
    adminReplies.quote_withdrawal = { data: { amountUsdc: "1", reservedUsdc: "1.5" } };
    expect(await quoteWithdrawalAction(ID)).toMatchObject({ ok: false, code: "unknown" });
  });

  it("an unknown request is not_found; a malformed id is invalid_input with no call", async () => {
    delete tables.withdrawal_requests;
    expect(await quoteWithdrawalAction(ID)).toMatchObject({ ok: false, code: "not_found" });
    vi.clearAllMocks();
    expect(await quoteWithdrawalAction("nope")).toMatchObject({ ok: false, code: "invalid_input" });
    expect(serverRpc).not.toHaveBeenCalled();
  });
});

describe("approveWithdrawalAction", () => {
  it("passes p_actor = the caller's member id and p_safe = the valuation's Safe", async () => {
    adminReplies.approve_withdrawal = { data: { amountUsdc: "8000000", selfApproved: false } };
    expect(await approveWithdrawalAction(ID)).toEqual({ ok: true, amountUsdc: "8000000" });
    expect(adminCalls("approve_withdrawal")).toEqual([
      { p_request: ID, p_actor: ME, p_safe: SAFE, p_assets_usd6: "40000000", p_assets_block: "120", p_eth_price_e8: "250000000000" },
    ]);
    revalidatedBoth();
  });

  it("valuation_unavailable when the Safe cannot be valued", async () => {
    valueSafe.mockResolvedValue(null);
    expect(await approveWithdrawalAction(ID)).toMatchObject({ ok: false, code: "valuation_unavailable" });
    expect(adminCalls("approve_withdrawal")).toEqual([]);
  });

  it("a throwing valuation is valuation_unavailable too", async () => {
    valueSafe.mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await approveWithdrawalAction(ID)).toMatchObject({ ok: false, code: "valuation_unavailable" });
    err.mockRestore();
  });

  it("retries assets_stale exactly once", async () => {
    adminReplies.approve_withdrawal = [{ error: { message: "assets_stale" } }, { data: { amountUsdc: "7" } }];
    expect(await approveWithdrawalAction(ID)).toEqual({ ok: true, amountUsdc: "7" });
    expect(valueSafe).toHaveBeenCalledTimes(2);
    expect(adminCalls("approve_withdrawal")).toHaveLength(2);
  });

  it.each([
    ["quote", () => quoteWithdrawalAction(ID), "quote_withdrawal"],
    ["approve", () => approveWithdrawalAction(ID), "approve_withdrawal"],
  ])("F4c-R7 (a) %s: with approved, unpaid withdrawals the Safe is scanned first, then valued", async (_n, run, rpcName) => {
    valuationCap.mockResolvedValue({ capped: true, block: 100n });
    const order: string[] = [];
    scanSafeOperations.mockImplementation(async () => (order.push("scan"), { inserted: 1, alerts: 0 }));
    valueSafe.mockImplementation(async () => (order.push("value"), valuation(120n)));
    adminReplies[rpcName] = { data: { amountUsdc: "8000000", reservedUsdc: "0" } };
    expect(await run()).toMatchObject({ ok: true });
    expect(scanSafeOperations).toHaveBeenCalledWith(59141);
    expect(order).toEqual(["scan", "value"]);
  });

  it("F4c-R7 (a): nothing approved and unpaid: no scan", async () => {
    adminReplies.approve_withdrawal = { data: { amountUsdc: "8000000" } };
    await approveWithdrawalAction(ID);
    expect(valuationCap).toHaveBeenCalledWith(59141);
    expect(scanSafeOperations).not.toHaveBeenCalled();
  });

  it("F4c-R7 (a): a failing scan or cap read is logged and the valuation still runs (SQL's guard decides)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    valuationCap.mockResolvedValue({ capped: true, block: 100n });
    scanSafeOperations.mockRejectedValue(new Error("rpc down"));
    adminReplies.approve_withdrawal = { error: { message: "assets_stale" } };
    expect(await approveWithdrawalAction(ID)).toMatchObject({ ok: false, code: "assets_stale" });
    valuationCap.mockRejectedValue(new Error("db down"));
    adminReplies.approve_withdrawal = { data: { amountUsdc: "7" } };
    expect(await approveWithdrawalAction(ID)).toEqual({ ok: true, amountUsdc: "7" });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("maps SQL refusals (withdrawals_disabled, safe_changed)", async () => {
    adminReplies.approve_withdrawal = { error: { message: "withdrawals_disabled" } };
    expect(await approveWithdrawalAction(ID)).toMatchObject({ ok: false, code: "withdrawals_disabled" });
    adminReplies.approve_withdrawal = { error: { message: "safe_changed" } };
    expect(await approveWithdrawalAction(ID)).toMatchObject({ ok: false, code: "safe_changed" });
  });
});

describe("markWithdrawalPaidAction", () => {
  it.each(["", "0x123", `0x${"zz".repeat(32)}`, `${"ab".repeat(32)}`, 42])("rejects the malformed hash %j with no RPC call", async (h) => {
    expect(await markWithdrawalPaidAction(ID, h as string)).toMatchObject({ ok: false, code: "invalid_input" });
    expect(serverRpc).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
    expect(verifyPayout).not.toHaveBeenCalled();
  });

  it("verifies against the request and records with the caller as actor", async () => {
    adminReplies.record_withdrawal_payout = { data: { status: "recorded" } };
    expect(await markWithdrawalPaidAction(ID, HASH.toUpperCase().replace("0X", "0x"))).toEqual({ ok: true, status: "recorded" });
    expect(verifyPayout).toHaveBeenCalledWith(
      { chain: 59141, safe: SAFE, destination: DEST, amountLocked: 8_000000n, approvedAt: new Date("2026-10-19T10:00:00.000Z") },
      HASH,
    );
    expect(adminCalls("record_withdrawal_payout")).toEqual([
      {
        p_request: ID,
        p_safe: SAFE,
        p_actor: ME,
        p_payout: { txHash: HASH, logIndex: 2, blockNumber: "130", blockTime: "2026-10-19T10:05:00.000Z", to: DEST, amount: "8000000" },
      },
    ]);
    revalidatedBoth();
  });

  it("returns already for the same payout again", async () => {
    adminReplies.record_withdrawal_payout = { data: { status: "already" } };
    expect(await markWithdrawalPaidAction(ID, HASH)).toEqual({ ok: true, status: "already" });
  });

  it("maps a pending verification to payout_pending", async () => {
    verifyPayout.mockResolvedValue({ status: "pending" });
    const r = await markWithdrawalPaidAction(ID, HASH);
    expect(r).toMatchObject({ ok: false, code: "payout_pending" });
    if (!r.ok) expect(r.error).toMatch(/confirmaciones suficientes/);
    expect(adminCalls("record_withdrawal_payout")).toEqual([]);
  });

  it.each(["tx_mismatch", "tx_failed", "tx_not_found", "tx_too_old", "rpc_unavailable"])("returns the verification error %s", async (code) => {
    verifyPayout.mockResolvedValue({ status: "error", code });
    expect(await markWithdrawalPaidAction(ID, HASH)).toMatchObject({ ok: false, code });
    expect(adminCalls("record_withdrawal_payout")).toEqual([]);
  });

  it("returns record refusals (tx_already_used)", async () => {
    adminReplies.record_withdrawal_payout = { error: { message: "tx_already_used" } };
    expect(await markWithdrawalPaidAction(ID, HASH)).toMatchObject({ ok: false, code: "tx_already_used" });
  });

  it("an expired approval is approval_expired without verifying; another state is invalid_state", async () => {
    tables.withdrawal_requests = { chain_id: 59141, member_id: MEMBER, status: "pending", destination_address: null, amount_usdc_locked: null, approved_at: null, last_expired_at: "2026-10-18T00:00:00Z" };
    expect(await markWithdrawalPaidAction(ID, HASH)).toMatchObject({ ok: false, code: "approval_expired" });
    tables.withdrawal_requests = { chain_id: 59141, member_id: MEMBER, status: "cancelled", destination_address: null, amount_usdc_locked: null, approved_at: null, last_expired_at: null };
    expect(await markWithdrawalPaidAction(ID, HASH)).toMatchObject({ ok: false, code: "invalid_state" });
    expect(verifyPayout).not.toHaveBeenCalled();
  });

  it("safe_not_configured when the chain has no Safe", async () => {
    safeAddressOf.mockResolvedValue(null);
    expect(await markWithdrawalPaidAction(ID, HASH)).toMatchObject({ ok: false, code: "safe_not_configured" });
  });
});

describe("member actions", () => {
  it.each(["1.5", "abc", "", "-1", "0", "1e18", " 12", "01"])("requestWithdrawalAction rejects %j with invalid_input", async (s) => {
    expect(await requestWithdrawalAction({ shares: s })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(serverRpc).not.toHaveBeenCalled();
  });

  it("requestWithdrawalAction sends the shares as text and returns the id", async () => {
    serverRpc.mockResolvedValueOnce({ data: ID, error: null });
    expect(await requestWithdrawalAction({ shares: "4000000000000000000" })).toEqual({ ok: true, id: ID });
    expect(serverRpc).toHaveBeenCalledWith("request_withdrawal", { p_shares: "4000000000000000000" });
    revalidatedBoth();
  });

  it("requestWithdrawalAction maps withdrawal_exists", async () => {
    serverRpc.mockResolvedValueOnce({ data: null, error: { message: "withdrawal_exists" } });
    expect(await requestWithdrawalAction({ shares: "1" })).toMatchObject({ ok: false, code: "withdrawal_exists" });
  });

  it("cancelWithdrawalAction calls cancel_withdrawal", async () => {
    expect(await cancelWithdrawalAction(ID)).toEqual({ ok: true });
    expect(serverRpc).toHaveBeenCalledWith("cancel_withdrawal", { p_request: ID });
    revalidatedBoth();
    expect(await cancelWithdrawalAction("x")).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("rejectWithdrawalAction passes the reason through (SQL trims and checks it)", async () => {
    expect(await rejectWithdrawalAction(ID, "Sin liquidez")).toEqual({ ok: true });
    expect(serverRpc).toHaveBeenCalledWith("reject_withdrawal", { p_request: ID, p_reason: "Sin liquidez" });
    revalidatedBoth();
    serverRpc.mockResolvedValueOnce({ data: null, error: { message: "reason_required" } });
    expect(await rejectWithdrawalAction(ID, " ")).toMatchObject({ ok: false, code: "reason_required" });
  });

  it("setWithdrawalsEnabledAction validates and calls set_withdrawals_enabled", async () => {
    expect(await setWithdrawalsEnabledAction(59141, true)).toEqual({ ok: true });
    expect(serverRpc).toHaveBeenCalledWith("set_withdrawals_enabled", { p_chain: 59141, p_enabled: true });
    revalidatedBoth();
    expect(await setWithdrawalsEnabledAction(1, true)).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await setWithdrawalsEnabledAction(59144, "yes" as unknown as boolean)).toMatchObject({ ok: false, code: "invalid_input" });
  });
});
