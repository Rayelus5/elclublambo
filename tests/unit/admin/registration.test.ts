import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const WALLET = "0x9F202eb556F95308de0268f60b5757d83744De02";
const OTHER = "0xD590d5D858d5B61C357e7a40Ee6b6a72D938b82d";
const userOf = (w: string) => ({ id: "u1", identities: [{ provider: "web3", identity_data: { custom_claims: { address: w } } }] });

const rpc = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
const getUser = vi.hoisted(() => vi.fn());
const deleteUser = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ auth: { admin: { deleteUser } } }) }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ auth: { getUser, signOut }, rpc }) }));

import { enforcePublicRegistration } from "@/lib/admin/registration";
import { publicRegistrationGate } from "@/lib/admin/registration-actions";

const supabase = { rpc, auth: { signOut } } as never;

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.SUPER_ADMIN_WALLET = WALLET;
  deleteUser.mockResolvedValue({ data: {}, error: null });
  signOut.mockResolvedValue({ error: null });
});
afterEach(() => vi.restoreAllMocks());

describe("enforcePublicRegistration", () => {
  it("blocked: deletes the new account, then signs out, and is closed", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await enforcePublicRegistration(supabase, "u1")).toBe("closed");
    expect(rpc).toHaveBeenCalledWith("my_registration_blocked");
    expect(deleteUser).toHaveBeenCalledWith("u1");
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(deleteUser.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0]!);
  });

  it("not blocked: touches nothing and is ok", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await enforcePublicRegistration(supabase, "u1")).toBe("ok");
    expect(deleteUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("an RPC error fails open and logs only a code, never the user", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await enforcePublicRegistration(supabase, "u1")).toBe("ok");
    expect(deleteUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("u1");
  });

  it("a failed delete still signs out and is closed (the hold keeps the account out)", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    deleteUser.mockResolvedValue({ data: null, error: { message: "nope" } });
    expect(await enforcePublicRegistration(supabase, "u1")).toBe("closed");
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("u1");
  });
});

describe("publicRegistrationGate", () => {
  it("no user -> ok, no RPC", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await publicRegistrationGate()).toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("status none and registration closed -> registration_closed", async () => {
    getUser.mockResolvedValue({ data: { user: userOf(OTHER) }, error: null });
    rpc.mockImplementation(async (fn: string) =>
      fn === "my_membership_status" ? { data: "none", error: null } : { data: true, error: null },
    );
    expect(await publicRegistrationGate()).toEqual({ ok: false, error: "registration_closed" });
    expect(deleteUser).toHaveBeenCalledWith("u1");
  });

  it("status none and registration open -> ok", async () => {
    getUser.mockResolvedValue({ data: { user: userOf(OTHER) }, error: null });
    rpc.mockImplementation(async (fn: string) =>
      fn === "my_membership_status" ? { data: "none", error: null } : { data: false, error: null },
    );
    expect(await publicRegistrationGate()).toEqual({ ok: true });
  });

  it.each(["active", "left", "banned"])("status %s never asks for the block", async (status) => {
    getUser.mockResolvedValue({ data: { user: userOf(OTHER) }, error: null });
    rpc.mockResolvedValue({ data: status, error: null });
    expect(await publicRegistrationGate()).toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalledWith("my_registration_blocked");
  });

  it("the SuperAdmin wallet is never blocked (its bootstrap must keep working)", async () => {
    getUser.mockResolvedValue({ data: { user: userOf(WALLET) }, error: null });
    rpc.mockResolvedValue({ data: "none", error: null });
    expect(await publicRegistrationGate()).toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalledWith("my_registration_blocked");
  });
});
