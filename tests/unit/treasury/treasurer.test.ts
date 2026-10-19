import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc }) }));

import { isPrizeToken } from "@/lib/treasury/raffles";
import { treasurerId } from "@/lib/treasury/treasurer";

let perms: unknown = "256";
let me: unknown = "m1";
beforeEach(() => {
  rpc.mockReset();
  perms = "256";
  me = "m1";
  rpc.mockImplementation(async (name: string) => ({ data: name === "my_permissions" ? perms : me, error: null }));
});

describe("treasurerId (the one gate of the treasury actions)", () => {
  it("is the caller's member id with MANAGE_TREASURY (256) or ADMINISTRATOR (512)", async () => {
    expect(await treasurerId()).toBe("m1");
    perms = "512";
    expect(await treasurerId()).toBe("m1");
    expect(rpc.mock.calls.map((c) => c[0]).sort()).toEqual(["current_member_id", "current_member_id", "my_permissions", "my_permissions"]);
  });
  it("is null without the bit, with malformed permissions or without a member id", async () => {
    perms = "1";
    expect(await treasurerId()).toBeNull();
    perms = "abc";
    expect(await treasurerId()).toBeNull();
    perms = null;
    expect(await treasurerId()).toBeNull();
    perms = "256";
    me = null;
    expect(await treasurerId()).toBeNull();
  });
});

describe("isPrizeToken", () => {
  it("accepts USDC and WETH only", () => {
    expect(isPrizeToken("USDC")).toBe(true);
    expect(isPrizeToken("WETH")).toBe(true);
    for (const v of ["ETH", "usdc", "", null, undefined, 1]) expect(isPrizeToken(v)).toBe(false);
  });
});
