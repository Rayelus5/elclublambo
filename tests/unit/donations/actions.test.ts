import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const verifyClubSafe = vi.hoisted(() => vi.fn());
vi.mock("@/lib/economy/club-safe", () => ({ verifyClubSafe }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc }) }));

import { createDonationIntentAction, setDonorVisibleAction } from "@/lib/donations/actions";

const valid = { chainId: 84532, token: "USDC" as const, amount: "10", anonymous: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
  verifyClubSafe.mockResolvedValue("ok");
  rpc.mockResolvedValue({ data: { id: "i1" }, error: null });
});

describe("createDonationIntentAction", () => {
  it("answers safe_not_deployed without calling the RPC", async () => {
    verifyClubSafe.mockResolvedValue("not_deployed");
    expect(await createDonationIntentAction(valid)).toMatchObject({ ok: false, code: "safe_not_deployed" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps a network error to rpc_unavailable", async () => {
    verifyClubSafe.mockResolvedValue("network");
    expect(await createDonationIntentAction(valid)).toMatchObject({ ok: false, code: "rpc_unavailable" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps not_configured to safe_not_configured", async () => {
    verifyClubSafe.mockResolvedValue("not_configured");
    expect(await createDonationIntentAction(valid)).toMatchObject({ ok: false, code: "safe_not_configured" });
  });
  it("rejects a chain outside the build", async () => {
    expect(await createDonationIntentAction({ ...valid, chainId: 8453 })).toMatchObject({ ok: false, code: "chain_invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    { ...valid, amount: "abc" },
    { ...valid, amount: "0" },
    { ...valid, token: "DAI" },
    { ...valid, anonymous: "no" },
    { ...valid, chainId: "84532" },
  ])("rejects invalid input %o", async (input) => {
    expect(await createDonationIntentAction(input as never)).toMatchObject({ ok: false, code: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("creates the intent with base units", async () => {
    const r = await createDonationIntentAction({ ...valid, amount: "12,5" });
    expect(r).toEqual({ ok: true, intent: { id: "i1" } });
    expect(rpc).toHaveBeenCalledWith("create_donation_intent", { p_chain_id: 84532, p_token: "USDC", p_amount: "12500000", p_anonymous: false });
  });
  it("converts ETH to wei", async () => {
    await createDonationIntentAction({ ...valid, token: "ETH", amount: "0.5" });
    expect(rpc).toHaveBeenCalledWith("create_donation_intent", expect.objectContaining({ p_token: "ETH", p_amount: "500000000000000000" }));
  });
  it("maps RPC errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "amount_out_of_range" } });
    expect(await createDonationIntentAction(valid)).toMatchObject({ ok: false, code: "amount_out_of_range" });
  });
});

describe("setDonorVisibleAction", () => {
  it("calls set_donor_visible", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await setDonorVisibleAction(false)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("set_donor_visible", { p_visible: false });
  });
  it("rejects non-booleans", async () => {
    expect(await setDonorVisibleAction("x" as never)).toMatchObject({ ok: false, code: "invalid_input" });
  });
});
