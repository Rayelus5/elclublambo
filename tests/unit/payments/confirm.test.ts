import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const verifyTransfer = vi.fn();
vi.mock("@/lib/payments/verify", () => ({ verifyTransfer: (...a: unknown[]) => verifyTransfer(...a) }));

const rpc = vi.fn();
const tables: Record<string, unknown> = {};
const tableErrors: Record<string, unknown> = {};
const selects: Record<string, unknown[]> = {};
function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "not", "gte", "order", "limit", "is"]) b[m] = (...a: unknown[]) => ((selects[table] ??= []).push([m, ...a]), b);
  b.maybeSingle = async () => (tableErrors[table] ? { data: null, error: tableErrors[table] } : { data: tables[table] ?? null, error: null });
  b.then = (res: (v: unknown) => unknown) => res(tableErrors[table] ? { data: null, error: tableErrors[table] } : { data: tables[table] ?? [], error: null });
  return b;
}
const admin = { from: (t: string) => builder(t), rpc: (...a: unknown[]) => rpc(...a) };
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));

const readEthUsd = vi.fn();
vi.mock("@/lib/economy/eth-price", async (orig) => ({
  ...(await orig<typeof import("@/lib/economy/eth-price")>()),
  readEthUsd: (...a: unknown[]) => readEthUsd(...a),
}));

const verifyClubSafe = vi.fn();
vi.mock("@/lib/economy/club-safe", () => ({ verifyClubSafe: (...a: unknown[]) => verifyClubSafe(...a) }));

import { confirmIntent, reverifyIntentsFor } from "@/lib/payments/confirm";

const PAYER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const RECIPIENT = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const PLATFORM = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const MAIN = `0x${"aa".repeat(32)}`;
const FEE = `0x${"bb".repeat(32)}`;
const CREATED = "2026-10-18T12:00:00.000Z";

function intent(over: Record<string, unknown> = {}) {
  return {
    id: "i1", purpose: "tip", member_id: "m1", chain_id: 84532, token: "USDC", amount: "1000000", fee_amount: "50000",
    recipient_address: RECIPIENT, platform_address: PLATFORM, status: "pending",
    main_tx_hash: MAIN, fee_tx_hash: FEE, created_at: CREATED, expires_at: "2026-10-19T12:00:00.000Z", ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(tableErrors)) delete tableErrors[k];
  for (const k of Object.keys(selects)) delete selects[k];
  tables.payment_intents = intent();
  tables.members = { wallet_address: PAYER };
  tables.tips = { id: "tip1" };
  verifyTransfer.mockImplementation(async (i: { txHash: string }) => ({ status: "ok", logIndex: i.txHash === FEE ? 3 : 7, blockNumber: 10n, blockTimestamp: new Date("2026-10-18T12:05:00.000Z") }));
  rpc.mockResolvedValue({ data: "tip1", error: null });
  verifyClubSafe.mockResolvedValue("ok");
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
});
afterEach(() => vi.unstubAllEnvs());

describe("confirmIntent", () => {
  it("verifies the fee first against the platform address, then the main against the recipient", async () => {
    expect(await confirmIntent("i1")).toEqual({ status: "confirmed", tipId: "tip1" });
    const calls = verifyTransfer.mock.calls.map((c) => c[0]);
    expect(calls[0]).toMatchObject({ txHash: FEE, to: PLATFORM, from: PAYER, amount: 50000n, token: "USDC", chain: 84532 });
    expect(calls[1]).toMatchObject({ txHash: MAIN, to: RECIPIENT, from: PAYER, amount: 1000000n });
    expect(calls[1].notBefore).toEqual(new Date(CREATED));
  });

  // Review Focus 4 / P0-R14: a leftover Linea intent, or a chain outside the build's set, is failed for good with
  // chain_disabled before anything touches a chain (the verifier is what builds the chain client).
  it.each([
    ["a leftover Linea intent", 59141, "tip"],
    ["a mainnet chain on a testnet build", 8453, "tip"],
    ["a bounty payment on a chain outside the build", 42161, "bounty"],
    ["a legacy donation", 59144, "donation"],
  ])("fails %s with chain_disabled without verifying", async (_label, chain_id, purpose) => {
    tables.payment_intents = intent({ chain_id, purpose });
    expect(await confirmIntent("i1")).toMatchObject({ status: "failed", code: "chain_disabled", error: "Esa red ya no está disponible." });
    expect(rpc).toHaveBeenCalledWith("fail_intent", { p_intent: "i1", p_code: "chain_disabled" });
    expect(verifyTransfer).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("confirm_tip", expect.anything());
    expect(rpc).not.toHaveBeenCalledWith("confirm_bounty_payment", expect.anything());
  });

  it("checks the chain even before the hashes: a Linea intent without hashes is failed too", async () => {
    tables.payment_intents = intent({ chain_id: 59141, main_tx_hash: null, fee_tx_hash: null });
    expect(await confirmIntent("i1")).toMatchObject({ status: "failed", code: "chain_disabled" });
  });

  it("a confirmed Linea intent still resolves to its tip (nothing to verify)", async () => {
    tables.payment_intents = intent({ chain_id: 59141, status: "confirmed" });
    expect(await confirmIntent("i1")).toEqual({ status: "confirmed", tipId: "tip1" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("verifies a mainnet intent on a mainnet build", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "mainnet");
    tables.payment_intents = intent({ chain_id: 8453 });
    expect(await confirmIntent("i1")).toEqual({ status: "confirmed", tipId: "tip1" });
    expect(verifyTransfer).toHaveBeenCalledWith(expect.objectContaining({ chain: 8453 }));
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

  it.each(["weird", undefined])("fails closed on unknown purpose %s: no verification, no confirm RPC", async (purpose) => {
    tables.payment_intents = intent({ purpose });
    expect(await confirmIntent("i1")).toMatchObject({ status: "failed", code: "invalid_input" });
    // it can never pass: failed for good so reverify stops retrying it
    expect(rpc).toHaveBeenCalledWith("fail_intent", { p_intent: "i1", p_code: "invalid_input" });
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

describe("confirmIntent: transient reads and definitive outcomes (F3-R3)", () => {
  const err = () => vi.spyOn(console, "error").mockImplementation(() => {});

  it("a failed intent read is transient: pending, not not_found, and nothing is verified", async () => {
    tableErrors.payment_intents = { message: "connection reset" };
    const spy = err();
    expect(await confirmIntent("i1")).toEqual({ status: "pending" });
    expect(verifyTransfer).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("a failed payer read is transient: pending", async () => {
    tableErrors.members = { message: "timeout" };
    const spy = err();
    expect(await confirmIntent("i1")).toEqual({ status: "pending" });
    expect(verifyTransfer).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("a payer read that succeeds with no row is a definitive not_found", async () => {
    tables.members = null;
    expect(await confirmIntent("i1")).toMatchObject({ status: "failed", code: "not_found" });
  });

  it("a failed tips read on a confirmed intent is pending", async () => {
    tables.payment_intents = intent({ status: "confirmed" });
    tableErrors.tips = { message: "boom" };
    const spy = err();
    expect(await confirmIntent("i1")).toEqual({ status: "pending" });
    spy.mockRestore();
  });

  it("a failed donations read on a confirmed donation is pending", async () => {
    tables.payment_intents = intent({ purpose: "donation", status: "confirmed" });
    tableErrors.donations = { message: "boom" };
    const spy = err();
    expect(await confirmIntent("i1")).toEqual({ status: "pending" });
    spy.mockRestore();
  });

  it("when fail_intent itself errors the intent stays pending (logged), never reported as failed", async () => {
    verifyTransfer.mockResolvedValue({ status: "error", code: "tx_mismatch" });
    rpc.mockImplementation(async (name: string) => (name === "fail_intent" ? { data: null, error: { message: "boom" } } : { data: null, error: null }));
    const spy = err();
    expect(await confirmIntent("i1")).toEqual({ status: "pending" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it.each(["invalid_input", "not_found"])("a confirm RPC recheck that can never pass (%s) fails the intent for good", async (code) => {
    tables.payment_intents = intent({ purpose: "bounty" });
    rpc.mockImplementation(async (name: string) =>
      name === "confirm_bounty_payment" ? { data: null, error: { message: code } } : { data: null, error: null });
    expect(await confirmIntent("i1")).toMatchObject({ status: "failed", code });
    expect(rpc).toHaveBeenCalledWith("fail_intent", { p_intent: "i1", p_code: code });
  });

  it("a confirm_donation recheck that can never pass (invalid_input) fails the intent for good", async () => {
    tables.payment_intents = intent({ purpose: "donation", fee_amount: "0", fee_tx_hash: null, platform_address: null });
    rpc.mockImplementation(async (name: string) =>
      name === "confirm_donation" ? { data: null, error: { message: "invalid_input" } } : { data: null, error: null });
    expect(await confirmIntent("i1")).toMatchObject({ status: "failed", code: "invalid_input" });
    expect(rpc).toHaveBeenCalledWith("fail_intent", { p_intent: "i1", p_code: "invalid_input" });
  });
});

describe("reverifyIntentsFor", () => {
  it("processes the newest intents first so stuck old ones cannot starve them", async () => {
    tables.payment_intents = [];
    await reverifyIntentsFor("m1", async () => ({ status: "pending" }));
    expect(selects.payment_intents).toContainEqual(["order", "created_at", { ascending: false }]);
  });

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

describe("confirmIntent: donations", () => {
  beforeEach(() => {
    tables.payment_intents = intent({ purpose: "donation", fee_amount: "0", fee_tx_hash: null, platform_address: null });
    rpc.mockResolvedValue({ data: { status: "confirmed", donationId: "don1" }, error: null });
    readEthUsd.mockResolvedValue({ priceE8: 236045646999n });
  });

  it("USDC: confirm_donation gets p_usd6 equal to the amount, no price, default confirmations", async () => {
    expect(await confirmIntent("i1")).toEqual({ status: "confirmed", donationId: "don1" });
    expect(rpc).toHaveBeenCalledWith("confirm_donation", {
      p_intent: "i1",
      p_main: { txHash: MAIN, logIndex: 7, blockNumber: "10" },
      p_usd6: "1000000",
      p_eth_price_e8: null,
    });
    expect(readEthUsd).not.toHaveBeenCalled();
    const arg = verifyTransfer.mock.calls[0]![0];
    expect(arg).toMatchObject({ txHash: MAIN, to: RECIPIENT, from: PAYER, amount: 1000000n });
    expect(arg).not.toHaveProperty("confirmations");
    expect(rpc).not.toHaveBeenCalledWith("confirm_tip", expect.anything());
  });

  it("ETH: reads the price and sends usd6 and the price", async () => {
    tables.payment_intents = intent({ purpose: "donation", token: "ETH", amount: "1000000000000000000", fee_amount: "0", fee_tx_hash: null, platform_address: null });
    expect(await confirmIntent("i1")).toEqual({ status: "confirmed", donationId: "don1" });
    expect(readEthUsd).toHaveBeenCalledWith(84532);
    expect(rpc).toHaveBeenCalledWith("confirm_donation", expect.objectContaining({ p_usd6: "2360456469", p_eth_price_e8: "236045646999" }));
  });

  it("ETH without a price stays pending with price_unavailable: no confirm_donation, no fail_intent", async () => {
    tables.payment_intents = intent({ purpose: "donation", token: "ETH", amount: "1000000000000000000", fee_amount: "0", fee_tx_hash: null, platform_address: null });
    readEthUsd.mockResolvedValue(null);
    expect(await confirmIntent("i1")).toEqual({ status: "pending", reason: "price_unavailable" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("the club Safe not deployed on that network: pending with safe_not_deployed, never credited nor failed", async () => {
    verifyClubSafe.mockResolvedValue("not_deployed");
    expect(await confirmIntent("i1")).toEqual({ status: "pending", reason: "safe_not_deployed" });
    expect(verifyClubSafe).toHaveBeenCalledWith(84532);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("the Safe check failing (network, not_configured) also stays pending, never credited", async () => {
    verifyClubSafe.mockResolvedValue("network");
    expect(await confirmIntent("i1")).toEqual({ status: "pending" });
    verifyClubSafe.mockResolvedValue("not_configured");
    expect(await confirmIntent("i1")).toEqual({ status: "pending" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a tip never asks for the club Safe", async () => {
    tables.payment_intents = intent();
    rpc.mockResolvedValue({ data: "tip1", error: null });
    await confirmIntent("i1");
    expect(verifyClubSafe).not.toHaveBeenCalled();
  });

  it("an already outcome of confirm_donation is also confirmed", async () => {
    rpc.mockResolvedValue({ data: { status: "already", donationId: "don1" }, error: null });
    expect(await confirmIntent("i1")).toEqual({ status: "confirmed", donationId: "don1" });
  });

  it("a transient confirm_donation error stays pending", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await confirmIntent("i1")).toEqual({ status: "pending" });
    expect(rpc).not.toHaveBeenCalledWith("fail_intent", expect.anything());
    spy.mockRestore();
  });

  it("an already-confirmed donation intent resolves from donations, without touching the chain", async () => {
    tables.payment_intents = intent({ purpose: "donation", status: "confirmed" });
    tables.donations = { id: "don1" };
    expect(await confirmIntent("i1")).toEqual({ status: "confirmed", donationId: "don1" });
    expect(verifyTransfer).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails the intent on a permanent verify error like any other purpose", async () => {
    verifyTransfer.mockResolvedValue({ status: "error", code: "tx_mismatch" });
    expect(await confirmIntent("i1")).toMatchObject({ status: "failed", code: "tx_mismatch" });
    expect(rpc).toHaveBeenCalledWith("fail_intent", { p_intent: "i1", p_code: "tx_mismatch" });
    expect(rpc).not.toHaveBeenCalledWith("confirm_donation", expect.anything());
  });

  it("includes donations in the interrupted-flow reverification", async () => {
    tables.payment_intents = [];
    await reverifyIntentsFor("m1", async () => ({ status: "pending" }));
    expect(selects.payment_intents).toContainEqual(["in", "purpose", ["tip", "bounty", "donation"]]);
  });
});
