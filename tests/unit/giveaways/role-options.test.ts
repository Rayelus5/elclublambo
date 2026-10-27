// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getRolesContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/roles/queries", () => ({ getRolesContext }));
const overwrites = vi.hoisted(() => ({ result: { data: [] as unknown[], error: null as { message: string } | null }, calls: [] as unknown[][] }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: (col: string, value: string) => {
          overwrites.calls.push([table, cols, col, value]);
          return Promise.resolve(overwrites.result);
        },
      }),
    }),
  }),
}));

import { widenedRoleIds } from "@/lib/giveaways/format";
import { getGiveawayRoleOptions } from "@/lib/giveaways/role-options";
import type { RoleItem } from "@/lib/roles/rules";

const role = (id: string, over: Partial<RoleItem> = {}): RoleItem => ({
  id,
  name: id,
  color: "#FFFFFF",
  position: 2,
  permissions: "1",
  isEveryone: false,
  isSystem: false,
  systemKey: null,
  ...over,
});

beforeEach(() => {
  overwrites.calls = [];
  overwrites.result = { data: [], error: null };
  getRolesContext.mockReset().mockResolvedValue({ roles: [role("vet"), role("mod-in-one-channel"), role("reacts")], actor: { isAdmin: true, perms: "512", top: 0 } });
});

describe("widenedRoleIds", () => {
  it("flags roles with an overwrite allowing bits outside 207895", () => {
    const ids = widenedRoleIds([
      { target_id: "a", allow: 8 }, // MANAGE_MESSAGES
      { target_id: "b", allow: 8192 }, // ADD_REACTIONS: member-safe
      { target_id: "c", allow: "207895" },
      { target_id: "d", allow: "x" },
    ]);
    expect([...ids].sort()).toEqual(["a", "d"]);
  });
});

describe("getGiveawayRoleOptions", () => {
  it("drops the roles some channel overwrite widens past the member-safe mask (as _giveaway_role_ok)", async () => {
    overwrites.result = { data: [{ target_id: "mod-in-one-channel", allow: 8 }, { target_id: "reacts", allow: 8192 }], error: null };
    const opts = await getGiveawayRoleOptions();
    expect(opts.map((o) => o.id)).toEqual(["vet", "reacts"]);
    expect(overwrites.calls).toEqual([["permission_overwrites", "target_id, allow", "target_type", "role"]]);
  });

  it("a failed overwrites read offers nothing rather than roles the server would refuse", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    overwrites.result = { data: [], error: { message: "down" } };
    expect(await getGiveawayRoleOptions()).toEqual([]);
    log.mockRestore();
  });
});
