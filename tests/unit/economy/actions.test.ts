import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { cancelOpenDonationIntentsAction } from "@/lib/economy/actions";

beforeEach(() => vi.clearAllMocks());

describe("cancelOpenDonationIntentsAction", () => {
  it("calls cancel_open_donation_intents for the chain and returns the count", async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    expect(await cancelOpenDonationIntentsAction(59141)).toEqual({ count: 2 });
    expect(rpc).toHaveBeenCalledWith("cancel_open_donation_intents", { p_chain: 59141 });
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("rejects an unsupported chain without calling the RPC", async () => {
    expect(await cancelOpenDonationIntentsAction(1)).toEqual({ error: "chain_invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps an RPC error to its code", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "forbidden" } });
    expect(await cancelOpenDonationIntentsAction(59144)).toEqual({ error: "forbidden" });
  });
});
