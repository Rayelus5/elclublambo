import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { pruneRateLimits } from "@/lib/rate-limit-cron";

beforeEach(() => vi.clearAllMocks());

describe("pruneRateLimits", () => {
  it("calls prune_rate_limits with the admin client and returns the count", async () => {
    rpc.mockResolvedValue({ data: { deleted: 7 }, error: null });
    expect(await pruneRateLimits()).toEqual({ deleted: 7 });
    expect(rpc).toHaveBeenCalledWith("prune_rate_limits");
  });

  it("throws on an RPC error and on a malformed payload (the route reports failed)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    await expect(pruneRateLimits()).rejects.toThrow();
    for (const data of [null, {}, { deleted: -1 }, { deleted: 1.5 }, { deleted: "3" }]) {
      rpc.mockResolvedValue({ data, error: null });
      await expect(pruneRateLimits()).rejects.toThrow();
    }
  });
});
