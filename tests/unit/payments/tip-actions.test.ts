import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const confirmIntent = vi.fn();
vi.mock("@/lib/payments/confirm", () => ({
  confirmIntent: (...a: unknown[]) => confirmIntent(...a),
}));

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
const valid = { targetType: "message" as const, targetId: ID, token: "USDC" as const, amount: "12,5", feeBps: 500, anonymous: false };

beforeEach(() => {
  vi.clearAllMocks();
  ownRow = { id: ID };
  ownError = null;
});

describe("createTipIntentAction", () => {
  it("converts the amount to base units and returns the intent", async () => {
    const intent = { id: ID, chainId: 59141, token: "USDC", amount: "12500000", feeAmount: "625000", recipientAddress: "0xa", platformAddress: "0xb", expiresAt: "x" };
    rpc.mockResolvedValue({ data: intent, error: null });
    expect(await createTipIntentAction(valid)).toEqual({ ok: true, intent });
    expect(rpc).toHaveBeenCalledWith("create_tip_intent", {
      p_target_type: "message", p_target_id: ID, p_token: "USDC", p_amount: "12500000", p_fee_bps: 500, p_anonymous: false,
    });
  });

  it.each([
    { amount: "abc" }, { amount: "-1" }, { amount: "1,0000001" }, { targetId: "nope" }, { token: "DAI" }, { targetType: "bounty" },
    { feeBps: 1.5 }, { feeBps: -1 }, { feeBps: 5001 },
  ])("rejects invalid input %o without calling the RPC", async (over) => {
    const r = await createTipIntentAction({ ...valid, ...over } as never);
    expect(r).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps RPC errors to Spanish copy and keeps the code", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "fee_below_minimum" } });
    expect(await createTipIntentAction(valid)).toMatchObject({ ok: false, code: "fee_below_minimum", error: expect.stringContaining("comisión") });
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
