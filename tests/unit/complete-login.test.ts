import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const WALLET = "0x9F202eb556F95308de0268f60b5757d83744De02";
const user = { id: "u1", identities: [{ provider: "web3", identity_data: { custom_claims: { address: WALLET } } }] };

const serverRpc = vi.fn();
const adminRpc = vi.fn();
const getUser = vi.fn();
const signOut = vi.fn();
const deleteUser = vi.fn();
const hit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({ hitRateLimit: hit }));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser, signOut }, rpc: serverRpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: adminRpc, auth: { admin: { deleteUser } } }) }));

import { completeLogin } from "@/lib/auth/actions";

beforeEach(() => {
  vi.resetAllMocks();
  process.env.SUPER_ADMIN_WALLET = WALLET;
  getUser.mockResolvedValue({ data: { user }, error: null });
  hit.mockResolvedValue("ok");
  deleteUser.mockResolvedValue({ data: {}, error: null });
  signOut.mockResolvedValue({ error: null });
});

describe("completeLogin", () => {
  it("no user -> /login", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await completeLogin(null)).toEqual({ redirectTo: "/foro/login" });
  });

  it("first status read errors -> /no-access with unknown", async () => {
    serverRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await completeLogin("abc")).toEqual({ redirectTo: "/foro/no-access", error: "unknown" });
  });

  it("active member -> /", async () => {
    serverRpc.mockResolvedValueOnce({ data: "active", error: null });
    expect(await completeLogin(null)).toEqual({ redirectTo: "/foro" });
  });

  it("bootstrap success then active -> /", async () => {
    serverRpc.mockResolvedValueOnce({ data: "none", error: null }).mockResolvedValueOnce({ data: "active", error: null });
    adminRpc.mockResolvedValue({ data: "m1", error: null });
    expect(await completeLogin(null)).toEqual({ redirectTo: "/foro" });
    expect(adminRpc).toHaveBeenCalledWith("bootstrap_super_admin", {
      p_auth_user_id: "u1",
      p_wallet: WALLET.toLowerCase(),
    });
  });

  it("bootstrap success but banned afterwards -> /banned", async () => {
    serverRpc.mockResolvedValueOnce({ data: "none", error: null }).mockResolvedValueOnce({ data: "banned", error: null });
    adminRpc.mockResolvedValue({ data: "m1", error: null });
    expect(await completeLogin(null)).toEqual({ redirectTo: "/foro/banned" });
  });

  it("bootstrap_closed without code -> /no-access", async () => {
    serverRpc.mockResolvedValueOnce({ data: "none", error: null });
    adminRpc.mockResolvedValue({ data: null, error: { message: "bootstrap_closed" } });
    expect(await completeLogin(null)).toEqual({ redirectTo: "/foro/no-access" });
  });

  it("bootstrap_closed falls through to redeem", async () => {
    serverRpc.mockResolvedValueOnce({ data: "none", error: null }).mockResolvedValueOnce({ data: "m2", error: null });
    adminRpc.mockResolvedValue({ data: null, error: { message: "bootstrap_closed" } });
    expect(await completeLogin("abc")).toEqual({ redirectTo: "/foro" });
    expect(serverRpc).toHaveBeenLastCalledWith("redeem_invite", { p_code: "abc" });
  });

  it("redeem error -> invite page with error", async () => {
    process.env.SUPER_ADMIN_WALLET = "";
    serverRpc
      .mockResolvedValueOnce({ data: "none", error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "invite_expired" } });
    expect(await completeLogin("Ab-9_z")).toEqual({
      redirectTo: "/foro/invite/Ab-9_z?error=invite_expired",
      error: "invite_expired",
    });
  });

  it("charges redeem_invite before redeeming", async () => {
    process.env.SUPER_ADMIN_WALLET = "";
    serverRpc.mockResolvedValueOnce({ data: "none", error: null }).mockResolvedValueOnce({ data: "m2", error: null });
    expect(await completeLogin("abc")).toEqual({ redirectTo: "/foro" });
    expect(hit).toHaveBeenCalledWith(expect.anything(), "redeem_invite");
    expect(hit.mock.invocationCallOrder[0]).toBeLessThan(serverRpc.mock.invocationCallOrder[1]!);
  });

  it("a limited pre-hit never calls redeem_invite (rate_limited; a failed pre-hit is unknown)", async () => {
    process.env.SUPER_ADMIN_WALLET = "";
    hit.mockResolvedValue("rate_limited");
    serverRpc.mockResolvedValue({ data: "none", error: null });
    expect(await completeLogin("abc")).toEqual({ redirectTo: "/foro/invite/abc?error=rate_limited", error: "rate_limited" });
    hit.mockResolvedValue("error");
    expect(await completeLogin("abc")).toEqual({ redirectTo: "/foro/invite/abc?error=unknown", error: "unknown" });
    expect(serverRpc).not.toHaveBeenCalledWith("redeem_invite", expect.anything());
  });

  it("the bootstrap_closed fall-through is charged too", async () => {
    hit.mockResolvedValue("rate_limited");
    serverRpc.mockResolvedValue({ data: "none", error: null });
    adminRpc.mockResolvedValue({ data: null, error: { message: "bootstrap_closed" } });
    expect(await completeLogin("abc")).toEqual({ redirectTo: "/foro/invite/abc?error=rate_limited", error: "rate_limited" });
    expect(serverRpc).not.toHaveBeenCalledWith("redeem_invite", expect.anything());
  });

  it.each([["a b"], ["x".repeat(65)], ["abc/../x"], [{ code: "abc" }], [42]])(
    "an invite code of the wrong shape (%j) is refused as not found, uncharged and unredeemed (S4)",
    async (code) => {
      process.env.SUPER_ADMIN_WALLET = "";
      serverRpc.mockResolvedValue({ data: "none", error: null });
      expect(await completeLogin(code as never)).toEqual({ redirectTo: "/foro/no-access", error: "invite_not_found" });
      expect(hit).not.toHaveBeenCalled();
      expect(serverRpc).not.toHaveBeenCalledWith("redeem_invite", expect.anything());
    },
  );

  it("a 64-character base64url code is still a valid shape", async () => {
    process.env.SUPER_ADMIN_WALLET = "";
    const code = "A".repeat(32) + "z_-9".repeat(8);
    serverRpc.mockResolvedValueOnce({ data: "none", error: null }).mockResolvedValueOnce({ data: "m2", error: null });
    expect(await completeLogin(code)).toEqual({ redirectTo: "/foro" });
    expect(serverRpc).toHaveBeenLastCalledWith("redeem_invite", { p_code: code });
  });

  it("banned -> /banned; none without code -> /no-access; no web3 wallet -> /no-access", async () => {
    serverRpc.mockResolvedValueOnce({ data: "banned", error: null });
    expect((await completeLogin("x")).redirectTo).toBe("/foro/banned");
    process.env.SUPER_ADMIN_WALLET = "";
    serverRpc.mockResolvedValueOnce({ data: "none", error: null });
    expect((await completeLogin(null)).redirectTo).toBe("/foro/no-access");
    getUser.mockResolvedValue({ data: { user: { id: "u1", identities: [] } }, error: null });
    expect((await completeLogin(null)).redirectTo).toBe("/foro/no-access");
  });
});

describe("completeLogin public mode", () => {
  it("none -> public, never redeems", async () => {
    process.env.SUPER_ADMIN_WALLET = "";
    serverRpc.mockResolvedValueOnce({ data: "none", error: null }).mockResolvedValueOnce({ data: false, error: null });
    expect(await completeLogin(null, "public")).toEqual({ redirectTo: "public" });
    expect(serverRpc).not.toHaveBeenCalledWith("redeem_invite", expect.anything());
  });
  it("left and active -> public", async () => {
    serverRpc.mockResolvedValueOnce({ data: "left", error: null });
    expect(await completeLogin(null, "public")).toEqual({ redirectTo: "public" });
    serverRpc.mockResolvedValueOnce({ data: "active", error: null });
    expect(await completeLogin(null, "public")).toEqual({ redirectTo: "public" });
  });
  it("banned -> /banned", async () => {
    serverRpc.mockResolvedValueOnce({ data: "banned", error: null });
    expect(await completeLogin(null, "public")).toEqual({ redirectTo: "/foro/banned" });
  });
  it("no user -> /login", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await completeLogin(null, "public")).toEqual({ redirectTo: "/foro/login" });
  });

  it("none with registration closed -> registration_closed, the new account is deleted and signed out", async () => {
    process.env.SUPER_ADMIN_WALLET = "";
    serverRpc.mockResolvedValueOnce({ data: "none", error: null }).mockResolvedValueOnce({ data: true, error: null });
    expect(await completeLogin(null, "public")).toEqual({ redirectTo: "public", error: "registration_closed" });
    expect(serverRpc).toHaveBeenLastCalledWith("my_registration_blocked");
    expect(deleteUser).toHaveBeenCalledWith("u1");
    expect(signOut).toHaveBeenCalledTimes(1);
  });
  it("an existing account (active or left) never asks for the block", async () => {
    process.env.SUPER_ADMIN_WALLET = "";
    serverRpc.mockResolvedValueOnce({ data: "active", error: null });
    expect(await completeLogin(null, "public")).toEqual({ redirectTo: "public" });
    serverRpc.mockResolvedValueOnce({ data: "left", error: null });
    expect(await completeLogin(null, "public")).toEqual({ redirectTo: "public" });
    expect(serverRpc).not.toHaveBeenCalledWith("my_registration_blocked");
  });
  it("the SuperAdmin wallet in public mode never asks for the block", async () => {
    serverRpc.mockResolvedValueOnce({ data: "none", error: null });
    expect(await completeLogin(null, "public")).toEqual({ redirectTo: "public" });
    expect(serverRpc).not.toHaveBeenCalledWith("my_registration_blocked");
    expect(deleteUser).not.toHaveBeenCalled();
  });
});

describe("completeLogin club mode with registration closed (A-R13)", () => {
  it("the SuperAdmin bootstrap never asks for the block", async () => {
    serverRpc.mockResolvedValueOnce({ data: "none", error: null }).mockResolvedValueOnce({ data: "active", error: null });
    adminRpc.mockResolvedValue({ data: "m1", error: null });
    expect(await completeLogin(null)).toEqual({ redirectTo: "/foro" });
    expect(serverRpc).not.toHaveBeenCalledWith("my_registration_blocked");
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it("an active member never asks for the block", async () => {
    serverRpc.mockResolvedValueOnce({ data: "active", error: null });
    expect(await completeLogin(null)).toEqual({ redirectTo: "/foro" });
    expect(serverRpc).not.toHaveBeenCalledWith("my_registration_blocked");
  });
  it("a club invite still redeems", async () => {
    process.env.SUPER_ADMIN_WALLET = "";
    serverRpc.mockResolvedValueOnce({ data: "none", error: null }).mockResolvedValueOnce({ data: "m2", error: null });
    expect(await completeLogin("abc")).toEqual({ redirectTo: "/foro" });
    expect(serverRpc).toHaveBeenLastCalledWith("redeem_invite", { p_code: "abc" });
    expect(serverRpc).not.toHaveBeenCalledWith("my_registration_blocked");
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
