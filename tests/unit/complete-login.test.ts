import { describe, it, expect, vi, beforeEach } from "vitest";

const WALLET = "0x9F202eb556F95308de0268f60b5757d83744De02";
const user = { id: "u1", identities: [{ provider: "web3", identity_data: { custom_claims: { address: WALLET } } }] };

const serverRpc = vi.fn();
const adminRpc = vi.fn();
const getUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser }, rpc: serverRpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: adminRpc }) }));

import { completeLogin } from "@/lib/auth/actions";

beforeEach(() => {
  vi.resetAllMocks();
  process.env.SUPER_ADMIN_WALLET = WALLET;
  getUser.mockResolvedValue({ data: { user }, error: null });
});

describe("completeLogin", () => {
  it("no user -> /login", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await completeLogin(null)).toEqual({ redirectTo: "/login" });
  });

  it("active member -> /", async () => {
    serverRpc.mockResolvedValueOnce({ data: "active", error: null });
    expect(await completeLogin(null)).toEqual({ redirectTo: "/" });
  });

  it("bootstrap success then active -> /", async () => {
    serverRpc.mockResolvedValueOnce({ data: "none", error: null }).mockResolvedValueOnce({ data: "active", error: null });
    adminRpc.mockResolvedValue({ data: "m1", error: null });
    expect(await completeLogin(null)).toEqual({ redirectTo: "/" });
    expect(adminRpc).toHaveBeenCalledWith("bootstrap_super_admin", {
      p_auth_user_id: "u1",
      p_wallet: WALLET.toLowerCase(),
    });
  });

  it("bootstrap success but banned afterwards -> /banned", async () => {
    serverRpc.mockResolvedValueOnce({ data: "none", error: null }).mockResolvedValueOnce({ data: "banned", error: null });
    adminRpc.mockResolvedValue({ data: "m1", error: null });
    expect(await completeLogin(null)).toEqual({ redirectTo: "/banned" });
  });

  it("bootstrap_closed without code -> /no-access", async () => {
    serverRpc.mockResolvedValueOnce({ data: "none", error: null });
    adminRpc.mockResolvedValue({ data: null, error: { message: "bootstrap_closed" } });
    expect(await completeLogin(null)).toEqual({ redirectTo: "/no-access" });
  });

  it("bootstrap_closed falls through to redeem", async () => {
    serverRpc.mockResolvedValueOnce({ data: "none", error: null }).mockResolvedValueOnce({ data: "m2", error: null });
    adminRpc.mockResolvedValue({ data: null, error: { message: "bootstrap_closed" } });
    expect(await completeLogin("abc")).toEqual({ redirectTo: "/" });
    expect(serverRpc).toHaveBeenLastCalledWith("redeem_invite", { p_code: "abc" });
  });

  it("redeem error -> invite page with error", async () => {
    process.env.SUPER_ADMIN_WALLET = "";
    serverRpc
      .mockResolvedValueOnce({ data: "none", error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "invite_expired" } });
    expect(await completeLogin("a b")).toEqual({
      redirectTo: "/invite/a%20b?error=invite_expired",
      error: "invite_expired",
    });
  });

  it("banned -> /banned; none without code -> /no-access; no web3 wallet -> /no-access", async () => {
    serverRpc.mockResolvedValueOnce({ data: "banned", error: null });
    expect((await completeLogin("x")).redirectTo).toBe("/banned");
    process.env.SUPER_ADMIN_WALLET = "";
    serverRpc.mockResolvedValueOnce({ data: "none", error: null });
    expect((await completeLogin(null)).redirectTo).toBe("/no-access");
    getUser.mockResolvedValue({ data: { user: { id: "u1", identities: [] } }, error: null });
    expect((await completeLogin(null)).redirectTo).toBe("/no-access");
  });
});
