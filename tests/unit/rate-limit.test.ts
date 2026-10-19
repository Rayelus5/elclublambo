import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { hitRateLimit } from "@/lib/rate-limit";

const client = (rpc: (...a: unknown[]) => unknown) => ({ rpc: vi.fn(rpc) }) as never;

describe("hitRateLimit", () => {
  it("charges the bucket through rate_limit_hit and answers ok", async () => {
    const supabase = client(async () => ({ data: null, error: null }));
    expect(await hitRateLimit(supabase, "chain_verify")).toBe("ok");
    expect((supabase as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith("rate_limit_hit", { p_bucket: "chain_verify" });
  });

  it("maps the rate_limited raise", async () => {
    expect(await hitRateLimit(client(async () => ({ data: null, error: { message: "rate_limited" } })), "redeem_invite")).toBe("rate_limited");
  });

  it("any other error is an error (the caller decides how to fail)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await hitRateLimit(client(async () => ({ data: null, error: { message: "TypeError: fetch failed" } })), "chain_verify")).toBe("error");
    expect(await hitRateLimit(client(async () => ({ data: null, error: { message: "not_authenticated" } })), "chain_verify")).toBe("error");
    err.mockRestore();
  });

  it("a thrown network failure is an error", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await hitRateLimit(client(async () => { throw new Error("socket hang up"); }), "chain_verify")).toBe("error");
    err.mockRestore();
  });
});
