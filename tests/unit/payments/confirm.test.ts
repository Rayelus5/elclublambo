import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const verifyTransfer = vi.fn();
vi.mock("@/lib/payments/verify", () => ({ verifyTransfer: (...a: unknown[]) => verifyTransfer(...a) }));

const rpc = vi.fn();
const tables: Record<string, unknown> = {};
const selects: Record<string, unknown[]> = {};
function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "not", "gte", "order", "limit", "is"]) b[m] = (...a: unknown[]) => ((selects[table] ??= []).push([m, ...a]), b);
  b.maybeSingle = async () => ({ data: tables[table] ?? null, error: null });
  b.then = (res: (v: unknown) => unknown) => res({ data: tables[table] ?? [], error: null });
  return b;
}
const admin = { from: (t: string) => builder(t), rpc: (...a: unknown[]) => rpc(...a) };
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));

import { confirmIntent, reverifyIntentsFor } from "@/lib/payments/confirm";

const PAYER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const RECIPIENT = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const PLATFORM = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const MAIN = `0x${"aa".repeat(32)}`;
const FEE = `0x${"bb".repeat(32)}`;
const CREATED = "2026-10-18T12:00:00.000Z";

function intent(over: Record<string, unknown> = {}) {
  return {
    id: "i1", purpose: "tip", member_id: "m1", chain_id: 59141, token: "USDC", amount: "1000000", fee_amount: "50000",
    recipient_address: RECIPIENT, platform_address: PLATFORM, status: "pending",
    main_tx_hash: MAIN, fee_tx_hash: FEE, created_at: CREATED, expires_at: "2026-10-19T12:00:00.000Z", ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(selects)) delete selects[k];
  tables.payment_intents = intent();
  tables.members = { wallet_address: PAYER };
  tables.tips = { id: "tip1" };
  verifyTransfer.mockImplementation(async (i: { txHash: string }) => ({ status: "ok", logIndex: i.txHash === FEE ? 3 : 7, blockNumber: 10n, blockTimestamp: new Date("2026-10-18T12:05:00.000Z") }));
  rpc.mockResolvedValue({ data: "tip1", error: null });
});

describe("confirmIntent", () => {
  it("verifies the fee first against the platform address, then the main against the recipient", async () => {
    expect(await confirmIntent("i1")).toEqual({ status: "confirmed", tipId: "tip1" });
    const calls = verifyTransfer.mock.calls.map((c) => c[0]);
    expect(calls[0]).toMatchObject({ txHash: FEE, to: PLATFORM, from: PAYER, amount: 50000n, token: "USDC", chain: 59141 });
    expect(calls[1]).toMatchObject({ txHash: MAIN, to: RECIPIENT, from: PAYER, amount: 1000000n });
    expect(calls[1].notBefore).toEqual(new Date(CREATED));
  });

  it("passes the verifier's log indexes and block numbers to confirm_tip", async () => {
    await confirmIntent("i1");
    expect(rpc).toHaveBeenCalledWith("confirm_tip", {
      p_intent: "i1",
      p_main: { txHash: MAIN, logIndex: 7, blockNumber: "10" },
      p_fee: { txHash: FEE, logIndex: 3, blockNumber: "10" },
    });
  });

  it("sends a null fee when there is no fee transfer", async () => {
    tables.payment_intents = intent({ fee_amount: "0", fee_tx_hash: null, platform_address: null });
    await confirmIntent("i1");
    expect(verifyTransfer).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("confirm_tip", expect.objectContaining({ p_fee: null }));
  });

  it.each(["tx_mismatch", "tx_failed", "tx_too_old"])("fails the intent on permanent %s", async (code) => {
    verifyTransfer.mockResolvedValue({ status: "error", code });
    const r = await confirmIntent("i1");
    expect(r).toMatchObject({ status: "failed", code });
    expect((r as { error: string }).error.length).toBeGreaterThan(5);
    expect(rpc).toHaveBeenCalledWith("fail_intent", { p_intent: "i1", p_code: code });
    expect(rpc).not.toHaveBeenCalledWith("confirm_tip", expect.anything());
  });

  it("confirms a bounty intent through confirm_bounty_payment with the block timestamp, tips without it", async () => {
    tables.payment_intents = intent({ purpose: "bounty" });
    await confirmIntent("i1");
    expect(rpc).toHaveBeenCalledWith("confirm_bounty_payment", {
      p_intent: "i1",
      p_main: { txHash: MAIN, logIndex: 7, blockNumber: "10", blockTimestamp: "2026-10-18T12:05:00.000Z" },
      p_fee: { txHash: FEE, logIndex: 3, blockNumber: "10" },
    });
    expect(rpc).not.toHaveBeenCalledWith("confirm_tip", expect.anything());
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: "tip1", error: null });
    tables.payment_intents = intent({ purpose: "tip" });
    await confirmIntent("i1");
    expect(rpc).toHaveBeenCalledWith("confirm_tip", expect.objectContaining({ p_main: { txHash: MAIN, logIndex: 7, blockNumber: "10" } }));
  });

  it.each(["donation", "weird", undefined])("fails closed on unknown purpose %s: no verification, no confirm RPC", async (purpose) => {
    tables.payment_intents = intent({ purpose });
    expect(await confirmIntent("i1")).toMatchObject({ status: "failed" });
    expect(verifyTransfer).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("confirm_tip", expect.anything());
    expect(rpc).not.toHaveBeenCalledWith("confirm_bounty_payment", expect.anything());
  });

  it("treats already_paid from confirm_bounty_payment as a permanent failure", async () => {
    tables.payment_intents = intent({ purpose: "bounty" });
    rpc.mockImplementation(async (name: string) =>
      name === "confirm_bounty_payment" ? { data: null, error: { message: "already_paid" } } : { data: null, error: null });
    expect(await confirmIntent("i1")).toMatchObject({ status: "failed", code: "already_paid" });
    expect(rpc).toHaveBeenCalledWith("fail_intent", { p_intent: "i1", p_code: "already_paid" });
  });

  it("fails with tx_already_used when confirm_tip reports it", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "confirm_tip" ? { data: null, error: { message: "tx_already_used" } } : { data: null, error: null });
    expect(await confirmIntent("i1")).toMatchObject({ status: "failed", code: "tx_already_used" });
    expect(rpc).toHaveBeenCalledWith("fail_intent", { p_intent: "i1", p_code: "tx_already_used" });
  });

  it("does not fail the intent when confirm_tip errors with something transient", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    expect(await confirmIntent("i1")).toEqual({ status: "pending" });
    expect(rpc).not.toHaveBeenCalledWith("fail_intent", expect.anything());
  });

  it.each([{ status: "pending" }, { status: "error", code: "tx_not_found" }, { status: "error", code: "rpc_unavailable" }])(
    "leaves the intent pending with no RPC write on %o",
    async (res) => {
      verifyTransfer.mockResolvedValue(res);
      expect(await confirmIntent("i1")).toEqual({ status: "pending" });
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("stops at the fee when the fee is still pending (main not checked)", async () => {
    verifyTransfer.mockResolvedValueOnce({ status: "pending" });
    await confirmIntent("i1");
    expect(verifyTransfer).toHaveBeenCalledTimes(1);
  });

  it("returns the existing tip for a confirmed intent without verifying or confirming again", async () => {
    tables.payment_intents = intent({ status: "confirmed" });
    expect(await confirmIntent("i1")).toEqual({ status: "confirmed", tipId: "tip1" });
    expect(verifyTransfer).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a failed intent with its stored code", async () => {
    tables.payment_intents = intent({ status: "failed", failure_code: "tx_mismatch" });
    expect(await confirmIntent("i1")).toMatchObject({ status: "failed", code: "tx_mismatch" });
    expect(verifyTransfer).not.toHaveBeenCalled();
  });

  it("stays pending while a required hash is missing", async () => {
    tables.payment_intents = intent({ fee_tx_hash: null });
    expect(await confirmIntent("i1")).toEqual({ status: "pending" });
    expect(verifyTransfer).not.toHaveBeenCalled();
  });

  it("is not_found for an unknown intent", async () => {
    tables.payment_intents = null;
    expect(await confirmIntent("i1")).toMatchObject({ status: "failed", code: "not_found" });
  });
});

describe("reverifyIntentsFor", () => {
  it("skips intents missing a required hash and caps at 5", async () => {
    tables.payment_intents = [
      ...Array.from({ length: 8 }, (_, n) => intent({ id: `ok${n}` })),
      intent({ id: "nofee", fee_tx_hash: null }),
      intent({ id: "nomain", main_tx_hash: null }),
    ];
    const spy = vi.fn();
    await reverifyIntentsFor("m1", async (id) => (spy(id), { status: "pending" }));
    expect(spy.mock.calls.map((c) => c[0])).toEqual(["ok0", "ok1", "ok2", "ok3", "ok4"]);
  });

  it("skips missing-hash intents before applying the cap", async () => {
    tables.payment_intents = [intent({ id: "nofee", fee_tx_hash: null }), intent({ id: "ok" })];
    const spy = vi.fn();
    await reverifyIntentsFor("m1", async (id) => (spy(id), { status: "pending" }));
    expect(spy.mock.calls.map((c) => c[0])).toEqual(["ok"]);
  });

  it("swallows and logs errors, continuing with the rest", async () => {
    tables.payment_intents = [intent({ id: "a" }), intent({ id: "b" })];
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: string[] = [];
    await reverifyIntentsFor("m1", async (id) => {
      seen.push(id);
      if (id === "a") throw new Error("rpc down");
      return { status: "pending" };
    });
    expect(seen).toEqual(["a", "b"]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("only queries the member's own pending intents", async () => {
    tables.payment_intents = [];
    await reverifyIntentsFor("m1", async () => ({ status: "pending" }));
    expect(selects.payment_intents).toEqual(expect.arrayContaining([["eq", "member_id", "m1"], ["eq", "status", "pending"]]));
  });
});
