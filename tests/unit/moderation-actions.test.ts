import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc, from }) }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { banMemberAction, toggleSponsorRoleAction } from "@/lib/moderation/actions";

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
    expect(revalidatePath).toHaveBeenCalledWith("/admin/members");
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

  function roleLookup(result: { data: unknown; error: unknown }) {
    from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => result }) }),
    });
  }

  it("rejects invalid member id", async () => {
    expect(await toggleSponsorRoleAction({ memberId: "x", enabled: true })).toEqual({ error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("looks up the Padrino role and calls set_member_role", async () => {
    roleLookup({ data: { id: ROLE }, error: null });
    rpc.mockResolvedValue({ error: null });
    expect(await toggleSponsorRoleAction({ memberId: ID, enabled: true })).toEqual({});
    expect(rpc).toHaveBeenCalledWith("set_member_role", { p_member: ID, p_role: ROLE, p_enabled: true });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/members");
  });

  it("errors when the role is missing or rpc fails", async () => {
    roleLookup({ data: null, error: null });
    expect(await toggleSponsorRoleAction({ memberId: ID, enabled: true })).toEqual({ error: "unknown" });
    roleLookup({ data: { id: ROLE }, error: null });
    rpc.mockResolvedValue({ error: { message: "forbidden" } });
    expect(await toggleSponsorRoleAction({ memberId: ID, enabled: false })).toEqual({ error: "forbidden" });
  });
});
