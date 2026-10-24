import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
});
afterEach(() => vi.unstubAllEnvs());

describe("createBountyAction", () => {
  it("converts the amount to base units and returns the message id", async () => {
    rpc.mockResolvedValue({ data: B, error: null });
    expect(await createBountyAction({ channelId: CH, body: doc, chainId: 84532, token: "USDC", amount: "12,5" })).toEqual({ ok: true, messageId: B });
    expect(rpc).toHaveBeenCalledWith("create_bounty", {
      p_channel: CH, p_body: expect.objectContaining({ type: "doc" }), p_chain_id: 84532, p_token: "USDC", p_amount: "12500000",
    });
    expect(schedulePushDispatch).toHaveBeenCalled();
  });

  it("a chain outside the build's set is chain_invalid without calling the RPC (Review Focus 5)", async () => {
    expect(await createBountyAction({ channelId: CH, body: doc, chainId: 8453, token: "USDC", amount: "5" })).toMatchObject({ ok: false, code: "chain_invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    { channelId: "x", body: doc, chainId: 84532, token: "USDC", amount: "5" },
    { channelId: CH, body: doc, chainId: 84532, token: "DAI", amount: "5" },
    { channelId: CH, body: doc, chainId: 84532, token: "USDC", amount: "abc" },
    { channelId: CH, body: doc, chainId: 84532, token: "USDC", amount: "0" },
    { channelId: CH, body: { type: "doc", content: [] }, chainId: 84532, token: "USDC", amount: "5" },
    { channelId: CH, body: doc, chainId: 59141, token: "USDC", amount: "5" },
    { channelId: CH, body: doc, token: "USDC", amount: "5" },
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
    const r = await createBountyAction({ channelId: CH, body: doc, chainId: 421614, token: "ETH", amount: "1" });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain(copy);
  });
});

describe("createBountyAction slowmode", () => {
  it("carries the remaining seconds of the slowmode error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "slowmode", details: "42" } });
    expect(await createBountyAction({ channelId: CH, body: doc, chainId: 84532, token: "USDC", amount: "5" })).toMatchObject({ ok: false, code: "slowmode", slowmodeSeconds: 42 });
  });

  it("omits the seconds when the detail is missing", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "slowmode" } });
    const r = await createBountyAction({ channelId: CH, body: doc, chainId: 84532, token: "USDC", amount: "5" });
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
  const intent = { id: R, chainId: 84532, token: "USDC", amount: "10000000", feeAmount: "0", recipientAddress: "0xa", platformAddress: null, expiresAt: "x" };
  const byName = (result: unknown) => async (name: string) => (name === "bounty_details" ? { data: [{ token: "USDC" }], error: null } : result);
  it("converts the amount and returns the intent", async () => {
    rpc.mockImplementation(byName({ data: intent, error: null }));
    expect(await createBountyPaymentIntentAction({ bountyId: B, chainId: 84532, amount: "10" })).toEqual({ ok: true, intent });
    expect(rpc).toHaveBeenCalledWith("create_bounty_payment_intent", { p_bounty: B, p_chain_id: 84532, p_amount: "10000000" });
  });
  it("a chain outside the build's set is chain_invalid without calling any RPC (Review Focus 5)", async () => {
    rpc.mockImplementation(byName({ data: intent, error: null }));
    expect(await createBountyPaymentIntentAction({ bountyId: B, chainId: 8453, amount: "10" })).toMatchObject({ ok: false, code: "chain_invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    { bountyId: "x", chainId: 84532, amount: "10" },
    { bountyId: B, chainId: 84532, amount: "-1" },
    { bountyId: B, chainId: 59141, amount: "10" },
    { bountyId: B, amount: "10" },
  ])("rejects invalid input %o", async (input) => {
    rpc.mockImplementation(byName({ data: intent, error: null }));
    expect(await createBountyPaymentIntentAction(input as never)).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalledWith("create_bounty_payment_intent", expect.anything());
  });
  it.each([
    ["payment_in_progress", "en curso"],
    ["network_not_accepted", "esa red"],
    ["amount_below_bounty", "menor"],
    ["already_paid", "ya está pagado"],
    ["no_solution", "elegir una respuesta"],
  ])("maps %s", async (code, copy) => {
    rpc.mockImplementation(byName({ data: null, error: { message: code } }));
    const r = await createBountyPaymentIntentAction({ bountyId: B, chainId: 84532, amount: "10" });
    expect((r as { error: string }).error).toContain(copy);
  });
  it("a failed token read is transient (unknown, retry), never not_found", async () => {
    rpc.mockImplementation(async (name: string) => (name === "bounty_details" ? { data: null, error: { message: "timeout" } } : { data: intent, error: null }));
    expect(await createBountyPaymentIntentAction({ bountyId: B, chainId: 84532, amount: "10" })).toMatchObject({ ok: false, code: "unknown" });
    expect(rpc).not.toHaveBeenCalledWith("create_bounty_payment_intent", expect.anything());
  });
  it("a token read that succeeds with no row is not_found", async () => {
    rpc.mockImplementation(async (name: string) => (name === "bounty_details" ? { data: [], error: null } : { data: intent, error: null }));
    expect(await createBountyPaymentIntentAction({ bountyId: B, chainId: 84532, amount: "10" })).toMatchObject({ ok: false, code: "not_found" });
  });
});
