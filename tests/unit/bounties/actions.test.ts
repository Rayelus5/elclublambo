import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const schedulePushDispatch = vi.fn();
vi.mock("@/lib/push/schedule", () => ({ schedulePushDispatch: () => schedulePushDispatch() }));

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import {
  cancelBountyAction,
  createBountyAction,
  createBountyPaymentIntentAction,
  markSolutionAction,
} from "@/lib/bounties/actions";

const CH = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const R = "33333333-3333-4333-8333-333333333333";
const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Se busca bug" }] }] };

beforeEach(() => vi.clearAllMocks());

describe("createBountyAction", () => {
  it("converts the amount to base units and returns the message id", async () => {
    rpc.mockResolvedValue({ data: B, error: null });
    expect(await createBountyAction({ channelId: CH, body: doc, token: "USDC", amount: "12,5" })).toEqual({ ok: true, messageId: B });
    expect(rpc).toHaveBeenCalledWith("create_bounty", { p_channel: CH, p_body: expect.objectContaining({ type: "doc" }), p_token: "USDC", p_amount: "12500000" });
    expect(schedulePushDispatch).toHaveBeenCalled();
  });

  it.each([
    { channelId: "x", body: doc, token: "USDC", amount: "5" },
    { channelId: CH, body: doc, token: "DAI", amount: "5" },
    { channelId: CH, body: doc, token: "USDC", amount: "abc" },
    { channelId: CH, body: doc, token: "USDC", amount: "0" },
    { channelId: CH, body: { type: "doc", content: [] }, token: "USDC", amount: "5" },
  ])("rejects invalid input %o without calling the RPC", async (input) => {
    const r = await createBountyAction(input as never);
    expect(r).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["forbidden", "No tienes permiso"],
    ["amount_out_of_range", "fuera de los límites"],
    ["slowmode", "demasiado rápido"],
  ])("maps %s to Spanish copy", async (code, copy) => {
    rpc.mockResolvedValue({ data: null, error: { message: code } });
    const r = await createBountyAction({ channelId: CH, body: doc, token: "ETH", amount: "1" });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain(copy);
  });
});

describe("createBountyAction slowmode", () => {
  it("carries the remaining seconds of the slowmode error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "slowmode", details: "42" } });
    expect(await createBountyAction({ channelId: CH, body: doc, token: "USDC", amount: "5" })).toMatchObject({ ok: false, code: "slowmode", slowmodeSeconds: 42 });
  });

  it("omits the seconds when the detail is missing", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "slowmode" } });
    const r = await createBountyAction({ channelId: CH, body: doc, token: "USDC", amount: "5" });
    expect(r).toMatchObject({ ok: false, code: "slowmode" });
    expect(r).not.toHaveProperty("slowmodeSeconds");
  });
});

describe("markSolutionAction", () => {
  it("calls mark_bounty_solution", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await markSolutionAction(B, R)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("mark_bounty_solution", { p_bounty: B, p_reply: R });
    expect(schedulePushDispatch).toHaveBeenCalled();
  });
  it("maps invalid_solution and already_marked", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "invalid_solution" } });
    expect(await markSolutionAction(B, R)).toMatchObject({ ok: false, error: expect.stringContaining("no puede ser la solución") });
    rpc.mockResolvedValue({ data: null, error: { message: "already_marked" } });
    expect(await markSolutionAction(B, R)).toMatchObject({ ok: false, error: expect.stringContaining("ya tiene una solución") });
  });
  it("rejects bad ids", async () => {
    expect(await markSolutionAction("x", R)).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("cancelBountyAction", () => {
  it("calls cancel_bounty and maps already_marked", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await cancelBountyAction(B)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("cancel_bounty", { p_bounty: B });
    rpc.mockResolvedValue({ data: null, error: { message: "already_marked" } });
    expect(await cancelBountyAction(B)).toMatchObject({ ok: false });
    expect(await cancelBountyAction("nope")).toMatchObject({ ok: false });
  });
});

describe("createBountyPaymentIntentAction", () => {
  const intent = { id: R, chainId: 59141, token: "USDC", amount: "10000000", feeAmount: "500000", recipientAddress: "0xa", platformAddress: "0xb", expiresAt: "x" };
  const byName = (result: unknown) => async (name: string) => (name === "bounty_details" ? { data: [{ token: "USDC" }], error: null } : result);
  it("converts the amount and returns the intent", async () => {
    rpc.mockImplementation(byName({ data: intent, error: null }));
    expect(await createBountyPaymentIntentAction({ bountyId: B, amount: "10", feeBps: 500 })).toEqual({ ok: true, intent });
    expect(rpc).toHaveBeenCalledWith("create_bounty_payment_intent", { p_bounty: B, p_amount: "10000000", p_fee_bps: 500 });
  });
  it.each([
    { bountyId: "x", amount: "10", feeBps: 500 },
    { bountyId: B, amount: "-1", feeBps: 500 },
    { bountyId: B, amount: "10", feeBps: 5001 },
    { bountyId: B, amount: "10", feeBps: 1.5 },
  ])("rejects invalid input %o", async (input) => {
    rpc.mockImplementation(byName({ data: intent, error: null }));
    expect(await createBountyPaymentIntentAction(input)).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalledWith("create_bounty_payment_intent", expect.anything());
  });
  it.each([
    ["payment_in_progress", "en curso"],
    ["bounty_chain_inactive", "otra red"],
    ["amount_below_bounty", "menor"],
    ["already_paid", "ya está pagado"],
    ["no_solution", "elegir una respuesta"],
  ])("maps %s", async (code, copy) => {
    rpc.mockImplementation(byName({ data: null, error: { message: code } }));
    const r = await createBountyPaymentIntentAction({ bountyId: B, amount: "10", feeBps: 500 });
    expect((r as { error: string }).error).toContain(copy);
  });
});
