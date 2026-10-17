import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const select = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ rpc, from: () => ({ select }) }),
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { getMyChannelPermsAction, searchMembersAction, setOverwriteAction } from "@/lib/channels/actions";
import { addDomainAction, removeDomainAction } from "@/lib/domains/actions";
import { createRoleAction, deleteRoleAction, moveRoleAction, updateRoleAction } from "@/lib/roles/actions";

const A = "6f1c1c5e-0000-4000-8000-000000000001";
const B = "6f1c1c5e-0000-4000-8000-000000000002";

beforeEach(() => {
  rpc.mockReset();
  select.mockReset();
  revalidatePath.mockReset();
});

describe("setOverwriteAction", () => {
  it("converts bigint strings and revalidates", async () => {
    rpc.mockResolvedValue({ error: null });
    expect(await setOverwriteAction(A, "role", B, "3", "4")).toEqual({});
    expect(rpc).toHaveBeenCalledWith("set_overwrite", {
      p_channel: A,
      p_target_type: "role",
      p_target: B,
      p_allow: 3,
      p_deny: 4,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/settings/channels");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it.each([
    ["x", "role", B, "1", "0"],
    [A, "other", B, "1", "0"],
    [A, "role", "nope", "1", "0"],
    [A, "role", B, "abc", "0"],
    [A, "role", B, "16", "0"],
    [A, "role", B, "1", "1"],
    [A, "role", B, "-1", "0"],
  ])("rejects invalid input %#", async (c, t, g, a, d) => {
    expect(await setOverwriteAction(c, t as "role", g, a, d)).toEqual({ error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps rpc errors", async () => {
    rpc.mockResolvedValue({ error: { message: "hierarchy" } });
    expect(await setOverwriteAction(A, "member", B, "0", "0")).toEqual({ error: "hierarchy" });
  });
});

describe("searchMembersAction", () => {
  const chain = (data: unknown) => {
    const limit = vi.fn().mockResolvedValue({ data, error: null });
    const or = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ or });
    select.mockReturnValue({ eq });
    return { limit, or, eq };
  };

  it("returns [] for short queries without querying", async () => {
    expect(await searchMembersAction("a")).toEqual([]);
    expect(select).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("returns [] when the caller lacks MANAGE_CHANNELS", async () => {
    rpc.mockResolvedValue({ data: 8199, error: null });
    expect(await searchMembersAction("ana")).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("my_permissions");
    expect(select).not.toHaveBeenCalled();
  });
  it("allows administrators", async () => {
    rpc.mockResolvedValue({ data: 512, error: null });
    chain([]);
    expect(await searchMembersAction("ana")).toEqual([]);
    expect(select).toHaveBeenCalled();
  });
  it("maps active rows and strips filter metacharacters", async () => {
    rpc.mockResolvedValue({ data: 128, error: null });
    const { limit, or, eq } = chain([{ id: A, display_name: "Ana", wallet_address: "0xabc" }]);
    const res = await searchMembersAction("an%,(a)");
    expect(eq).toHaveBeenCalledWith("status", "active");
    expect(or).toHaveBeenCalledWith("display_name.ilike.%ana%,wallet_address.ilike.%ana%");
    expect(limit).toHaveBeenCalledWith(10);
    expect(res).toEqual([{ id: A, displayName: "Ana", walletAddress: "0xabc" }]);
  });
  it("collapses whitespace to single spaces and keeps dots", async () => {
    rpc.mockResolvedValue({ data: 128, error: null });
    const { or } = chain([]);
    await searchMembersAction("  Ana   María.  Pérez ");
    expect(or).toHaveBeenCalledWith("display_name.ilike.%ana maría. pérez%,wallet_address.ilike.%ana maría. pérez%");
  });
});

describe("getMyChannelPermsAction", () => {
  it("returns the actor bits for one channel", async () => {
    rpc.mockResolvedValue({ data: 31759, error: null });
    expect(await getMyChannelPermsAction(A)).toEqual({ bits: "31759" });
    expect(rpc).toHaveBeenCalledWith("my_channel_permissions", { p_channel: A });
  });
  it("rejects bad ids", async () => {
    expect(await getMyChannelPermsAction("x")).toEqual({ error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("role actions", () => {
  it("creates a role with uppercase color", async () => {
    rpc.mockResolvedValue({ data: B, error: null });
    const res = await createRoleAction({ name: " VIP ", color: "#61dfff", permissions: "16" });
    expect(rpc).toHaveBeenCalledWith("create_role", { p_name: "VIP", p_color: "#61DFFF", p_permissions: 16 });
    expect(res).toEqual({ id: B });
    expect(revalidatePath).toHaveBeenCalledWith("/settings/roles");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it("rejects bad color, name, and the administrator bit", async () => {
    expect(await createRoleAction({ name: "x", color: "red", permissions: "0" })).toEqual({ error: "invalid_input" });
    expect(await createRoleAction({ name: "", color: "#61DFFF", permissions: "0" })).toEqual({
      error: "invalid_input",
    });
    expect(await createRoleAction({ name: "x", color: "#61DFFF", permissions: "512" })).toEqual({
      error: "invalid_input",
    });
    expect(await createRoleAction({ name: "x", color: "#61DFFF", permissions: "65536" })).toEqual({
      error: "invalid_input",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("updates, moves and deletes", async () => {
    rpc.mockResolvedValue({ error: null });
    expect(await updateRoleAction({ id: A, name: "n", color: "#ededed", permissions: "8199" })).toEqual({});
    expect(rpc).toHaveBeenLastCalledWith("update_role", {
      p_role: A,
      p_name: "n",
      p_color: "#EDEDED",
      p_permissions: 8199,
    });
    expect(await moveRoleAction(A, 5)).toEqual({});
    expect(rpc).toHaveBeenLastCalledWith("move_role", { p_role: A, p_position: 5 });
    expect(await moveRoleAction(A, 0.5)).toEqual({ error: "invalid_input" });
    expect(await deleteRoleAction(A)).toEqual({});
    expect(rpc).toHaveBeenLastCalledWith("delete_role", { p_role: A });
    expect(await deleteRoleAction("zzz")).toEqual({ error: "invalid_input" });
  });
});

describe("domain actions", () => {
  it("normalizes and validates", async () => {
    rpc.mockResolvedValue({ error: null });
    expect(await addDomainAction("  GitHub.com ")).toEqual({});
    expect(rpc).toHaveBeenCalledWith("add_allowed_domain", { p_domain: "github.com" });
    expect(revalidatePath).toHaveBeenCalledWith("/settings/links");
    expect(await addDomainAction("not a domain")).toEqual({ error: "invalid_input" });
    expect(await removeDomainAction("x.com")).toEqual({});
    expect(rpc).toHaveBeenLastCalledWith("remove_allowed_domain", { p_domain: "x.com" });
    expect(await removeDomainAction("")).toEqual({ error: "invalid_input" });
  });
});
