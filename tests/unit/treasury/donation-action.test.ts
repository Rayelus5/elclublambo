import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createDonationIntentAction } from "@/lib/treasury/actions";

beforeEach(() => rpc.mockReset().mockResolvedValue({ data: { id: "i1" }, error: null }));

describe("createDonationIntentAction acknowledgement (F4a-R8)", () => {
  it.each([undefined, false, "true", 1, null])("rejects %s without creating an intent", async (ack) => {
    const r = await createDonationIntentAction({ amount: "10", feeBps: 100, acknowledged: ack as unknown as true });
    expect(r).toMatchObject({ ok: false, code: "acknowledgement_required" });
    if (!r.ok) expect(r.error).toMatch(/aceptar/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("creates the intent when acknowledged is exactly true", async () => {
    const r = await createDonationIntentAction({ amount: "10", feeBps: 100, acknowledged: true });
    expect(r.ok).toBe(true);
    // F4a-R11: the acknowledgement also travels to the RPC, which refuses without it
    expect(rpc).toHaveBeenCalledWith("create_donation_intent", { p_amount: "10000000", p_fee_bps: 100, p_acknowledged: true });
  });

  it("maps the RPC's acknowledgement_required refusal to the same copy", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "acknowledgement_required" } });
    const r = await createDonationIntentAction({ amount: "10", feeBps: 100, acknowledged: true });
    expect(r).toMatchObject({ ok: false, code: "acknowledgement_required" });
  });
});
