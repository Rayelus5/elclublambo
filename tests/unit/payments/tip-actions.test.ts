import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const confirmIntent = vi.fn();
vi.mock("@/lib/payments/confirm", () => ({
  confirmIntent: (...a: unknown[]) => confirmIntent(...a),
}));

const hit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({ hitRateLimit: hit }));

const rpc = vi.fn();
let ownRow: unknown = null;
let ownError: unknown = null;
const supabase = {
  rpc: (...a: unknown[]) => rpc(...a),
  from: () => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.maybeSingle = async () => (ownError ? { data: null, error: ownError } : { data: ownRow, error: null });
    return b;
  },
};
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => supabase }));

import { attachTxAction, createTipIntentAction, verifyIntentAction } from "@/lib/payments/tip-actions";

const ID = "11111111-1111-4111-8111-111111111111";
const HASH = `0x${"ab".repeat(32)}`;
const valid = { targetType: "message" as const, targetId: ID, chainId: 84532 as const, token: "USDC" as const, amount: "12,5", anonymous: false };

beforeEach(() => {
  vi.clearAllMocks();
  ownRow = { id: ID };
  ownError = null;
  hit.mockResolvedValue("ok");
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
});
afterEach(() => vi.unstubAllEnvs());

describe("createTipIntentAction", () => {
  it("converts the amount to base units and returns the intent", async () => {
    const intent = { id: ID, chainId: 84532, token: "USDC", amount: "12500000", feeAmount: "0", recipientAddress: "0xa", platformAddress: null, expiresAt: "x" };
    rpc.mockResolvedValue({ data: intent, error: null });
    expect(await createTipIntentAction(valid)).toEqual({ ok: true, intent });
    // no p_fee_bps: the RPC takes the chain and charges no fee (P0-R5)
    expect(rpc).toHaveBeenCalledWith("create_tip_intent", {
      p_target_type: "message", p_target_id: ID, p_chain_id: 84532, p_token: "USDC", p_amount: "12500000", p_anonymous: false,
    });
  });

  it("a chain outside the build's set is chain_invalid without calling the RPC (Review Focus 5)", async () => {
    expect(await createTipIntentAction({ ...valid, chainId: 8453 })).toMatchObject({ ok: false, code: "chain_invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([59141, 1, "84532", undefined])("a chain id that is not a network (%s) is invalid_input without calling the RPC", async (chainId) => {
    expect(await createTipIntentAction({ ...valid, chainId } as never)).toMatchObject({ ok: false, code: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    { amount: "abc" }, { amount: "-1" }, { amount: "1,0000001" }, { targetId: "nope" }, { token: "DAI" }, { targetType: "bounty" },
    { anonymous: "no" },
  ])("rejects invalid input %o without calling the RPC", async (over) => {
    const r = await createTipIntentAction({ ...valid, ...over } as never);
    expect(r).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps RPC errors to Spanish copy and keeps the code", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "network_not_accepted" } });
    expect(await createTipIntentAction(valid)).toMatchObject({ ok: false, code: "network_not_accepted", error: expect.stringContaining("esa red") });
  });
});

describe("attachTxAction", () => {
  it("lowercases and attaches the hash", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await attachTxAction(ID, "fee", `0x${"AB".repeat(32)}`)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("attach_intent_tx", { p_intent: ID, p_role: "fee", p_tx_hash: HASH });
  });

  it.each([["nope", "main", HASH], [ID, "other", HASH], [ID, "main", "0x123"]])("rejects bad input %s %s %s", async (i, r, h) => {
    expect(await attachTxAction(i, r as never, h)).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces RPC errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "tx_already_attached" } });
    expect(await attachTxAction(ID, "main", HASH)).toMatchObject({ ok: false, code: "tx_already_attached" });
  });
});

describe("verifyIntentAction", () => {
  it("delegates to confirmIntent for the caller's own intent", async () => {
    confirmIntent.mockResolvedValue({ status: "confirmed", tipId: "t1" });
    expect(await verifyIntentAction(ID)).toEqual({ status: "confirmed", tipId: "t1" });
    expect(confirmIntent).toHaveBeenCalledWith(ID);
  });

  it("refuses an intent the caller cannot see (not theirs) without verifying", async () => {
    ownRow = null;
    expect(await verifyIntentAction(ID)).toMatchObject({ status: "failed" });
    expect(confirmIntent).not.toHaveBeenCalled();
  });

  it("a failed ownership read is transient: pending, never not_found (F3-R3)", async () => {
    ownError = { message: "connection reset" };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await verifyIntentAction(ID)).toEqual({ status: "pending" });
    expect(confirmIntent).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("charges chain_verify after the ownership read, before confirming", async () => {
    confirmIntent.mockResolvedValue({ status: "pending" });
    await verifyIntentAction(ID);
    expect(hit).toHaveBeenCalledWith(supabase, "chain_verify");
    ownRow = null;
    hit.mockClear();
    await verifyIntentAction(ID);
    expect(hit).not.toHaveBeenCalled();
  });

  it("a limited verification stays pending (never failed) and never reaches the chain (Review Focus 1)", async () => {
    hit.mockResolvedValue("rate_limited");
    expect(await verifyIntentAction(ID)).toEqual({ status: "pending" });
    hit.mockResolvedValue("error");
    expect(await verifyIntentAction(ID)).toEqual({ status: "pending" });
    expect(confirmIntent).not.toHaveBeenCalled();
  });

  it("not_found only when the read succeeded with no row", async () => {
    ownRow = null;
    expect(await verifyIntentAction(ID)).toMatchObject({ status: "failed", code: "not_found" });
  });

  it("rejects a malformed id", async () => {
    expect(await verifyIntentAction("x")).toMatchObject({ status: "failed" });
    expect(confirmIntent).not.toHaveBeenCalled();
  });

  it("returns pending as is", async () => {
    confirmIntent.mockResolvedValue({ status: "pending" });
    expect(await verifyIntentAction(ID)).toEqual({ status: "pending" });
  });
});
