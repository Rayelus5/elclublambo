import { describe, expect, it } from "vitest";
import { formatCountdown, giveawayRoleOptions } from "@/lib/giveaways/format";
import type { RoleItem } from "@/lib/roles/rules";

describe("formatCountdown", () => {
  it("days and hours, hours and minutes, minutes and seconds", () => {
    expect(formatCountdown((2 * 86400 + 4 * 3600 + 59) * 1000)).toBe("2 d 4 h");
    expect(formatCountdown((3 * 3600 + 20 * 60 + 7) * 1000)).toBe("3 h 20 min");
    expect(formatCountdown((9 * 60 + 5) * 1000)).toBe("9 min 5 s");
    expect(formatCountdown(42_400)).toBe("42 s");
  });
  it("null at or past zero", () => {
    expect(formatCountdown(0)).toBeNull();
    expect(formatCountdown(-5)).toBeNull();
  });
});

const role = (over: Partial<RoleItem>): RoleItem => ({
  id: "r",
  name: "R",
  color: "#ffffff",
  position: 5,
  permissions: "1",
  isEveryone: false,
  isSystem: false,
  systemKey: null,
  ...over,
});

describe("giveawayRoleOptions (P1-R9, the server re-checks)", () => {
  const roles = [
    role({ id: "every", name: "@everyone", position: 0, isEveryone: true }),
    role({ id: "sys", name: "Admin", position: 9, isSystem: true }),
    role({ id: "key", name: "Mecenas", position: 2, systemKey: "donor" }),
    role({ id: "mod", name: "Moderador", position: 4, permissions: String(1 | 8) }),
    role({ id: "high", name: "Alto", position: 7 }),
    role({ id: "vet", name: "Veterano", position: 3, permissions: String(207895) }),
  ];

  it("keeps only member-safe roles below the creator", () => {
    const opts = giveawayRoleOptions({ roles, actor: { isAdmin: false, perms: String(256 | 64 | 207895), top: 6 } });
    expect(opts.map((r) => r.id)).toEqual(["vet"]);
    expect(opts[0]).toEqual({ id: "vet", name: "Veterano", color: "#ffffff" });
  });

  it("a treasurer without MANAGE_ROLES (64) gets no role at all (as _giveaway_role_ok)", () => {
    expect(giveawayRoleOptions({ roles, actor: { isAdmin: false, perms: "256", top: 6 } })).toEqual([]);
    expect(giveawayRoleOptions({ roles, actor: { isAdmin: false, top: 6 } })).toEqual([]);
  });

  it("with MANAGE_ROLES, only roles whose permissions the creator also holds", () => {
    const more = [...roles, role({ id: "rare", name: "Raro", position: 2, permissions: String(16) })];
    // the creator lacks bit 16: neither Veterano (207895 includes 16) nor Raro (16) is offered
    const opts = giveawayRoleOptions({ roles: more, actor: { isAdmin: false, perms: String(256 | 64 | (207895 & ~16)), top: 6 } });
    expect(opts).toEqual([]);
    const withRare = giveawayRoleOptions({ roles: more, actor: { isAdmin: false, perms: String(256 | 64 | 16 | 1), top: 6 } });
    expect(withRare.map((r) => r.id)).toEqual(["rare"]);
  });

  it("an administrator may pick any member-safe role", () => {
    const opts = giveawayRoleOptions({ roles, actor: { isAdmin: true, perms: "512", top: 0 } });
    expect(opts.map((r) => r.id)).toEqual(["high", "vet"]);
  });
});
