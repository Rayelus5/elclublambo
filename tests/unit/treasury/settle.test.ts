import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const verifyTransfer = vi.fn();
vi.mock("@/lib/payments/verify", () => ({ verifyTransfer: (...a: unknown[]) => verifyTransfer(...a) }));

const getBlock = vi.fn();
const chainClient = vi.fn<(c: number) => object>(() => ({ getBlock: (...a: unknown[]) => getBlock(...a) }));
vi.mock("@/lib/payments/chain-client", () => ({ chainClient: (c: number) => chainClient(c) }));

const valueSafe = vi.fn();
vi.mock("@/lib/treasury/snapshot", () => ({ valueSafe: (...a: unknown[]) => valueSafe(...a) }));

const rpc = vi.fn();
let ledgerRows: Record<string, unknown>[] = [];
const filters: unknown[][] = [];
const tables: Record<string, unknown> = {};
function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order"]) b[m] = (...a: unknown[]) => (table === "dao_ledger" && filters.push([m, ...a]), b);
  b.limit = (n: number) => (filters.push(["limit", n]), b);
  b.maybeSingle = async () => ({ data: tables[table] ?? null, error: null });
  b.then = (res: (v: unknown) => unknown) => res({ data: table === "dao_ledger" ? ledgerRows : [], error: null });
  return b;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => builder(t), rpc: (...a: unknown[]) => rpc(...a) }) }));

import { settlePendingDonations, shouldSettleFromView } from "@/lib/treasury/settle";

const PAYER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const SAFE = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const PLATFORM = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const MAIN = `0x${"aa".repeat(32)}`;
const FEE = `0x${"bb".repeat(32)}`;

const row = (id: string, block: number, over: Record<string, unknown> = {}) => ({
  id, chain_id: 59141, member_id: "m1", intent_id: `i-${id}`, tx_hash: MAIN, block_number: String(block), ...over,
});
const VALUATION = {
  assetsUsd6: 12_345_678n,
  priceE8: 200_000_000_000n,
  source: "chainlink",
  assets: { usdc: 12_345_678n, eth: 0n, weth: 0n, blockNumber: 120n },
  blockNumber: 120n,
};
// F4d: the ETH price of the valuation values open WETH prizes at the credit-time price
const CREDIT = { p_ledger: "l1", p_assets_usd6: "12345678", p_assets_block: "120", p_eth_price_e8: "200000000000" };
const ok = (blockNumber: bigint) => ({ status: "ok", logIndex: 1, blockNumber, blockTimestamp: new Date("2026-10-18T12:05:00.000Z") });

beforeEach(() => {
  vi.clearAllMocks();
  ledgerRows = [row("l1", 100)];
  filters.length = 0;
  for (const k of Object.keys(tables)) delete tables[k];
  tables.payment_intents = {
    id: "i-l1", chain_id: 59141, token: "USDC", amount: "1000000", fee_amount: "0", recipient_address: SAFE,
    platform_address: null, main_tx_hash: MAIN, fee_tx_hash: null, created_at: "2026-10-18T12:00:00.000Z",
  };
  tables.members = { wallet_address: PAYER };
  getBlock.mockResolvedValue({ number: 100n });
  verifyTransfer.mockResolvedValue(ok(100n));
  rpc.mockResolvedValue({ data: null, error: null });
  valueSafe.mockResolvedValue(VALUATION);
});

describe("settlePendingDonations: the finalized gate", () => {
  it("leaves a row above the finalized block untouched and does not verify it", async () => {
    getBlock.mockResolvedValue({ number: 99n });
    expect(await settlePendingDonations()).toEqual({ credited: 0, reverted: 0, pending: 1 });
    expect(verifyTransfer).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("credits a row exactly at the finalized block after re-verifying with confirmations: 1", async () => {
    expect(await settlePendingDonations()).toEqual({ credited: 1, reverted: 0, pending: 0 });
    expect(getBlock).toHaveBeenCalledWith({ blockTag: "finalized" });
    expect(verifyTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ chain: 59141, token: "USDC", txHash: MAIN, from: PAYER, to: SAFE, amount: 1000000n, confirmations: 1 }),
    );
    expect(rpc).toHaveBeenCalledWith("credit_donation", CREDIT);
  });

  it("credits a row below the finalized block", async () => {
    getBlock.mockResolvedValue({ number: 500n });
    expect(await settlePendingDonations()).toMatchObject({ credited: 1 });
  });

  it("uses the receipt's current block, not the stored one: a reorged-and-remined tx past finality stays pending", async () => {
    verifyTransfer.mockResolvedValue(ok(150n));
    expect(await settlePendingDonations()).toEqual({ credited: 0, reverted: 0, pending: 1 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("gates on the max of the main and fee receipt blocks", async () => {
    tables.payment_intents = { ...(tables.payment_intents as object), fee_amount: "50000", platform_address: PLATFORM, fee_tx_hash: FEE };
    verifyTransfer.mockImplementation(async (i: { txHash: string }) => (i.txHash === FEE ? ok(101n) : ok(100n)));
    expect(await settlePendingDonations()).toEqual({ credited: 0, reverted: 0, pending: 1 });
    expect(verifyTransfer).toHaveBeenCalledWith(expect.objectContaining({ txHash: FEE, to: PLATFORM, amount: 50000n, confirmations: 1 }));
    expect(rpc).not.toHaveBeenCalled();
    verifyTransfer.mockImplementation(async (i: { txHash: string }) => (i.txHash === FEE ? ok(99n) : ok(100n)));
    expect(await settlePendingDonations()).toMatchObject({ credited: 1 });
  });
});

describe("settlePendingDonations: failures", () => {
  it.each(["tx_mismatch", "tx_failed", "tx_too_old"])("reverts on permanent %s (Review Focus 4)", async (code) => {
    verifyTransfer.mockResolvedValue({ status: "error", code });
    expect(await settlePendingDonations()).toEqual({ credited: 0, reverted: 1, pending: 0 });
    expect(rpc).toHaveBeenCalledWith("revert_donation", { p_ledger: "l1" });
    expect(rpc).not.toHaveBeenCalledWith("credit_donation", expect.anything());
  });

  it("a first tx_not_found only marks the row as missing: no revert (M4)", async () => {
    verifyTransfer.mockResolvedValue({ status: "error", code: "tx_not_found" });
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await settlePendingDonations()).toEqual({ credited: 0, reverted: 0, pending: 1 });
    expect(rpc).toHaveBeenCalledWith("donation_missing", { p_ledger: "l1", p_missing: true });
    expect(rpc).not.toHaveBeenCalledWith("revert_donation", expect.anything());
  });

  it("tx_not_found reverts once the RPC says it has been missing for 30 minutes", async () => {
    verifyTransfer.mockResolvedValue({ status: "error", code: "tx_not_found" });
    rpc.mockImplementation(async (name: string) => ({ data: name === "donation_missing" ? true : null, error: null }));
    expect(await settlePendingDonations()).toEqual({ credited: 0, reverted: 1, pending: 0 });
    expect(rpc).toHaveBeenCalledWith("revert_donation", { p_ledger: "l1" });
  });

  it("a failing donation_missing call leaves the row alone", async () => {
    verifyTransfer.mockResolvedValue({ status: "error", code: "tx_not_found" });
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await settlePendingDonations()).toMatchObject({ reverted: 0, pending: 1 });
    err.mockRestore();
  });

  it("a permanent error wins over a not-found on the other transfer", async () => {
    tables.payment_intents = { ...(tables.payment_intents as object), fee_amount: "50000", platform_address: PLATFORM, fee_tx_hash: FEE };
    verifyTransfer.mockImplementation(async (i: { txHash: string }) => (i.txHash === FEE ? { status: "error", code: "tx_not_found" } : { status: "error", code: "tx_mismatch" }));
    expect(await settlePendingDonations()).toMatchObject({ reverted: 1 });
    expect(rpc).not.toHaveBeenCalledWith("donation_missing", expect.anything());
  });

  it("finding the tx again clears the missing mark before crediting", async () => {
    ledgerRows = [row("l1", 100, { missing_since: "2026-10-18T12:00:00Z" })];
    expect(await settlePendingDonations()).toMatchObject({ credited: 1 });
    expect(rpc).toHaveBeenCalledWith("donation_missing", { p_ledger: "l1", p_missing: false });
  });

  it("does not call donation_missing for a row that was never missing", async () => {
    await settlePendingDonations();
    expect(rpc).not.toHaveBeenCalledWith("donation_missing", expect.anything());
  });

  it("reverts when only the fee transfer no longer verifies", async () => {
    tables.payment_intents = { ...(tables.payment_intents as object), fee_amount: "50000", platform_address: PLATFORM, fee_tx_hash: FEE };
    verifyTransfer.mockImplementation(async (i: { txHash: string }) => (i.txHash === FEE ? { status: "error", code: "tx_mismatch" } : ok(100n)));
    expect(await settlePendingDonations()).toMatchObject({ reverted: 1 });
  });

  it.each([{ status: "pending" }, { status: "error", code: "rpc_unavailable" }])(
    "leaves the row alone on transient result %j",
    async (res) => {
      verifyTransfer.mockResolvedValue(res);
      expect(await settlePendingDonations()).toEqual({ credited: 0, reverted: 0, pending: 1 });
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("an RPC error reading the finalized block writes nothing and keeps every row pending", async () => {
    ledgerRows = [row("l1", 1), row("l2", 2)];
    getBlock.mockRejectedValue(new Error("timeout"));
    expect(await settlePendingDonations()).toEqual({ credited: 0, reverted: 0, pending: 2 });
    expect(verifyTransfer).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a failing credit RPC leaves the row pending and the loop going", async () => {
    ledgerRows = [row("l1", 1), row("l2", 2, { intent_id: "i-l2" })];
    rpc.mockImplementationOnce(async () => ({ data: null, error: { message: "boom" } }));
    expect(await settlePendingDonations()).toEqual({ credited: 1, reverted: 0, pending: 1 });
  });
});

describe("settlePendingDonations: market NAV", () => {
  it("credits with the Safe's market valuation and the block it was read at", async () => {
    expect(await settlePendingDonations()).toMatchObject({ credited: 1 });
    expect(valueSafe).toHaveBeenCalledWith(59141);
    expect(rpc).toHaveBeenCalledWith("credit_donation", CREDIT);
  });

  it("no valuation (Safe unread or no price): the row stays pending and credit_donation is not called (Review Focus 1)", async () => {
    valueSafe.mockResolvedValue(null);
    expect(await settlePendingDonations()).toEqual({ credited: 0, reverted: 0, pending: 1 });
    expect(rpc).not.toHaveBeenCalledWith("credit_donation", expect.anything());
  });

  it("a throwing valuation keeps the row pending", async () => {
    valueSafe.mockRejectedValue(new Error("boom"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await settlePendingDonations()).toEqual({ credited: 0, reverted: 0, pending: 1 });
    err.mockRestore();
  });

  it("values the Safe lazily, once per chain per call, and only when a row is ready to credit", async () => {
    ledgerRows = [row("l1", 1), row("l2", 2, { intent_id: "i-l2" })];
    await settlePendingDonations();
    expect(valueSafe).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();
    getBlock.mockResolvedValue({ number: 0n });
    await settlePendingDonations();
    expect(valueSafe).not.toHaveBeenCalled();
  });

  it.each(["assets_stale", "invalid_state"])("%s is transient: pending, retried next run", async (code) => {
    rpc.mockImplementation(async (name: string) => ({ data: null, error: name === "credit_donation" ? { message: code } : null }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await settlePendingDonations()).toEqual({ credited: 0, reverted: 0, pending: 1 });
    expect(rpc).not.toHaveBeenCalledWith("revert_donation", expect.anything());
    err.mockRestore();
  });

  it("shares_zero leaves the row pending for the treasurer and logs [treasury] shares_zero", async () => {
    rpc.mockImplementation(async (name: string) => ({ data: null, error: name === "credit_donation" ? { message: "shares_zero" } : null }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await settlePendingDonations()).toEqual({ credited: 0, reverted: 0, pending: 1 });
    expect(err).toHaveBeenCalledWith("[treasury] shares_zero", "l1", expect.anything());
    expect(rpc).not.toHaveBeenCalledWith("revert_donation", expect.anything());
    err.mockRestore();
  });
});

describe("settlePendingDonations: scoping", () => {
  it("caps a call at 20 rows", async () => {
    await settlePendingDonations();
    expect(filters).toContainEqual(["limit", 20]);
    await settlePendingDonations(undefined, { limit: 500 });
    expect(filters.filter((f) => f[0] === "limit").at(-1)).toEqual(["limit", 20]);
  });

  it("filters by chain, member and ledger id when given", async () => {
    await settlePendingDonations(59144, { memberId: "m9", ledgerId: "l9", limit: 5 });
    expect(filters).toEqual(
      expect.arrayContaining([["eq", "status", "pending_finality"], ["eq", "chain_id", 59144], ["eq", "member_id", "m9"], ["eq", "id", "l9"], ["limit", 5]]),
    );
  });

  it("reads the finalized block once per chain", async () => {
    ledgerRows = [row("l1", 1), row("l2", 2, { intent_id: "i-l2" }), row("l3", 3, { chain_id: 59144, intent_id: "i-l3" })];
    tables.payment_intents = { ...(tables.payment_intents as object), chain_id: 59141 };
    await settlePendingDonations();
    expect(chainClient).toHaveBeenCalledTimes(2);
  });
});

describe("shouldSettleFromView", () => {
  it("lets one /dao view settle, then throttles views for 30 s", () => {
    const t0 = 10_000_000;
    expect(shouldSettleFromView(t0)).toBe(true);
    expect(shouldSettleFromView(t0 + 1_000)).toBe(false);
    expect(shouldSettleFromView(t0 + 29_999)).toBe(false);
    expect(shouldSettleFromView(t0 + 30_000)).toBe(true);
  });
});
