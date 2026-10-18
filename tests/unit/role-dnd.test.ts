import { describe, expect, it } from "vitest";
import { canDragRole, dropPosition, type RoleItem } from "@/lib/roles/rules";

const r = (name: string, position: number, extra: Partial<RoleItem> = {}): RoleItem => ({
  id: name,
  name,
  color: "#ffffff",
  position,
  permissions: "0",
  isEveryone: false,
  isSystem: false,
  systemKey: null,
  ...extra,
});
const admin = { isAdmin: true, top: 1000 };
const delegate = { isAdmin: false, top: 500 };
const superadmin = r("SuperAdmin", 1000, { isSystem: true });
const everyone = r("@everyone", 0, { isEveryone: true });
const verified = r("Verificado", 20, { systemKey: "verified" });

describe("roles drag & drop", () => {
  it("SuperAdmin and @everyone are never draggable; system_key roles only for the SuperAdmin", () => {
    expect(canDragRole(superadmin, admin)).toBe(false);
    expect(canDragRole(everyone, admin)).toBe(false);
    expect(canDragRole(verified, admin)).toBe(true);
    expect(canDragRole(verified, delegate)).toBe(false);
    expect(canDragRole(r("Soporte", 100), delegate)).toBe(true);
    expect(canDragRole(r("Moderador", 500), delegate)).toBe(false); // not below the delegate's top
  });

  it("dropping lands just above the role below it", () => {
    const order = [superadmin, r("Moderador", 500), r("Padrino", 10), r("Soporte", 100), everyone];
    expect(dropPosition(order, "Padrino")).toBe(101);
  });

  it("dropping last (just above @everyone) lands at position 1", () => {
    const order = [superadmin, r("Soporte", 100), r("Moderador", 500), everyone];
    expect(dropPosition(order, "Moderador")).toBe(1);
  });
});
