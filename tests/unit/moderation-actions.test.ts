import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc, from }) }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { banMemberAction, setVerifiedAction, toggleSponsorRoleAction } from "@/lib/moderation/actions";

const ID = "11111111-1111-4111-8111-111111111111";
const ROLE = "22222222-2222-4222-8222-222222222222";

describe("banMemberAction", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
    revalidatePath.mockReset();
  });

  it("rejects bad reason or id without calling the rpc", async () => {
    for (const reason of ["", "  ab ", "x".repeat(501)]) {
      expect(await banMemberAction({ memberId: ID, reason, penalizeSponsor: false })).toEqual({
        error: "invalid_input",
      });
    }
    expect(await banMemberAction({ memberId: "nope", reason: "spam", penalizeSponsor: false })).toEqual({
      error: "invalid_input",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends trimmed reason and revalidates on success", async () => {
    rpc.mockResolvedValue({ data: "ban-id", error: null });
    expect(await banMemberAction({ memberId: ID, reason: "  spam  ", penalizeSponsor: true })).toEqual({});
    expect(rpc).toHaveBeenCalledWith("ban_member", {
      p_target: ID,
      p_reason: "spam",
      p_penalize_sponsor: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/foro/admin/members");
  });

  it("maps rpc errors, including deadlocks to retry", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "hierarchy" } });
    expect(await banMemberAction({ memberId: ID, reason: "spam", penalizeSponsor: false })).toEqual({
      error: "hierarchy",
    });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "40P01", message: "deadlock detected" } });
    expect(await banMemberAction({ memberId: ID, reason: "spam", penalizeSponsor: false })).toEqual({
      error: "retry",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("toggleSponsorRoleAction", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
    revalidatePath.mockReset();
  });

  const eq = vi.fn();

  function roleLookup(result: { data: unknown; error: unknown }) {
    from.mockReturnValue({
      select: () => ({ eq: eq.mockReturnValue({ maybeSingle: async () => result }) }),
    });
  }

  it("rejects invalid member id", async () => {
    expect(await toggleSponsorRoleAction({ memberId: "x", enabled: true })).toEqual({ error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("looks up the sponsor role by system_key and calls set_member_role", async () => {
    roleLookup({ data: { id: ROLE }, error: null });
    rpc.mockResolvedValue({ error: null });
    expect(await toggleSponsorRoleAction({ memberId: ID, enabled: true })).toEqual({});
    expect(eq).toHaveBeenCalledWith("system_key", "sponsor");
    expect(rpc).toHaveBeenCalledWith("set_member_role", { p_member: ID, p_role: ROLE, p_enabled: true });
    expect(revalidatePath).toHaveBeenCalledWith("/foro/admin/members");
  });

  it("errors when the role is missing or rpc fails", async () => {
    roleLookup({ data: null, error: null });
    expect(await toggleSponsorRoleAction({ memberId: ID, enabled: true })).toEqual({ error: "unknown" });
    roleLookup({ data: { id: ROLE }, error: null });
    rpc.mockResolvedValue({ error: { message: "forbidden" } });
    expect(await toggleSponsorRoleAction({ memberId: ID, enabled: false })).toEqual({ error: "forbidden" });
  });
});

describe("setVerifiedAction", () => {
  beforeEach(() => {
    rpc.mockReset();
    revalidatePath.mockReset();
  });

  it("rejects invalid member id without calling the rpc", async () => {
    expect(await setVerifiedAction({ memberId: "x", enabled: true })).toEqual({ error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls set_verified and revalidates", async () => {
    rpc.mockResolvedValue({ error: null });
    expect(await setVerifiedAction({ memberId: ID, enabled: true })).toEqual({});
    expect(rpc).toHaveBeenCalledWith("set_verified", { p_member: ID, p_enabled: true });
    expect(revalidatePath).toHaveBeenCalledWith("/foro/admin/members");
  });

  it("coerces enabled to a strict boolean", async () => {
    rpc.mockResolvedValue({ error: null });
    await setVerifiedAction({ memberId: ID, enabled: undefined as unknown as boolean });
    expect(rpc).toHaveBeenCalledWith("set_verified", { p_member: ID, p_enabled: false });
  });

  it("maps rpc errors and does not revalidate", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "hierarchy" } });
    expect(await setVerifiedAction({ memberId: ID, enabled: true })).toEqual({ error: "hierarchy" });
    rpc.mockResolvedValueOnce({ error: { message: "forbidden" } });
    expect(await setVerifiedAction({ memberId: ID, enabled: false })).toEqual({ error: "forbidden" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
