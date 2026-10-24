import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { setChainEnabledAction } from "@/lib/economy/actions";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
});

describe("setChainEnabledAction", () => {
  it("calls set_chain_enabled for a chain of the build and revalidates", async () => {
    rpc.mockResolvedValue({ error: null });
    expect(await setChainEnabledAction(421614, true)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("set_chain_enabled", { p_chain: 421614, p_enabled: true });
    expect(revalidatePath).toHaveBeenCalled();
  });

  it.each([59141, 59144, 1])("rejects %i with invalid_input without calling the RPC", async (chain) => {
    expect(await setChainEnabledAction(chain as never, true)).toEqual({ ok: false, error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a chain outside the build's network set", async () => {
    expect(await setChainEnabledAction(8453, true)).toEqual({ ok: false, error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean flag", async () => {
    expect(await setChainEnabledAction(84532, "yes" as never)).toEqual({ ok: false, error: "invalid_input" });
  });

  it("maps an RPC error to its code", async () => {
    rpc.mockResolvedValue({ error: { message: "forbidden" } });
    expect(await setChainEnabledAction(84532, false)).toEqual({ ok: false, error: "forbidden" });
  });
});
