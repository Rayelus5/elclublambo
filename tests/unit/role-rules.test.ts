import { describe, expect, it } from "vitest";
import { canManageRole, canMoveTo } from "@/lib/roles/rules";

const r = (over = {}) => ({ id: "a", position: 10, isSystem: false, isEveryone: false, ...over });

describe("canManageRole", () => {
  it("non-admin needs position below top and a non-system role", () => {
    expect(canManageRole(r(), { isAdmin: false, top: 20 })).toBe(true);
    expect(canManageRole(r({ position: 20 }), { isAdmin: false, top: 20 })).toBe(false);
    expect(canManageRole(r({ isSystem: true }), { isAdmin: false, top: 20 })).toBe(false);
  });
  it("admin manages any non-system role", () => {
    expect(canManageRole(r({ position: 999 }), { isAdmin: true, top: 1000 })).toBe(true);
    expect(canManageRole(r({ isSystem: true }), { isAdmin: true, top: 1000 })).toBe(false);
  });
  it("@everyone is editable (permissions only)", () => {
    expect(canManageRole(r({ isEveryone: true, position: 0 }), { isAdmin: false, top: 20 })).toBe(true);
  });
});

describe("canMoveTo", () => {
  it("requires 1..top-1", () => {
    expect(canMoveTo(5, { isAdmin: false, top: 20 })).toBe(true);
    expect(canMoveTo(0, { isAdmin: false, top: 20 })).toBe(false);
    expect(canMoveTo(20, { isAdmin: false, top: 20 })).toBe(false);
  });
});
