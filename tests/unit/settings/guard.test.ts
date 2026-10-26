import { describe, expect, it, vi } from "vitest";
import { isHiddenSettingsPage } from "@/lib/permissions/settings-guard";

const SUPER = 1023n; // every global bit, SuperAdmin (512) included
const CHANNELS = 128n; // MANAGE_CHANNELS only

function client(opts: { perms?: unknown; permsError?: unknown; status?: unknown; statusError?: unknown }) {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "my_permissions") return { data: "perms" in opts ? opts.perms : "0", error: opts.permsError ?? null };
    if (fn === "my_membership_status") return { data: "status" in opts ? opts.status : "active", error: opts.statusError ?? null };
    throw new Error(`unexpected rpc ${fn}`);
  });
  return { rpc, from: vi.fn() };
}

describe("isHiddenSettingsPage", () => {
  it.each(["/", "/foro/settingsx", "/foro/x/settings", "/foro/c/abc", "/settings", "/settings/economia", "/foro/foro/settings"])("%s is not a settings page: no query", async (p) => {
    const c = client({});
    expect(await isHiddenSettingsPage(c as never, p)).toBe(false);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it.each(["/foro/settings", "/foro/settings/", "/foro/settings/economia", "/foro/settings/roles"])("%s is hidden from a member with no settings section", async (p) => {
    expect(await isHiddenSettingsPage(client({ perms: "0" }) as never, p)).toBe(true);
  });

  it("hides a section the member lacks, even when another section is visible", async () => {
    const c = client({ perms: String(CHANNELS) });
    expect(await isHiddenSettingsPage(c as never, "/foro/settings/economia")).toBe(true);
    expect(await isHiddenSettingsPage(c as never, "/foro/settings/roles")).toBe(true);
    expect(await isHiddenSettingsPage(c as never, "/foro/settings/channels")).toBe(false);
    expect(await isHiddenSettingsPage(c as never, "/foro/settings")).toBe(false);
  });

  it("a MANAGE_ROLES-only delegate opens Roles and nothing else", async () => {
    const c = client({ perms: "64" });
    expect(await isHiddenSettingsPage(c as never, "/foro/settings/roles")).toBe(false);
    expect(await isHiddenSettingsPage(c as never, "/foro/settings")).toBe(false);
    for (const p of ["/foro/settings/channels", "/foro/settings/links", "/foro/settings/economia"]) {
      expect(await isHiddenSettingsPage(c as never, p)).toBe(true);
    }
  });

  it("shows every section to the SuperAdmin; unknown subpaths are left to the router", async () => {
    const c = client({ perms: String(SUPER) });
    for (const p of ["/foro/settings", "/foro/settings/economia", "/foro/settings/roles", "/foro/settings/channels", "/foro/settings/links", "/foro/settings/nope"]) {
      expect(await isHiddenSettingsPage(c as never, p)).toBe(false);
    }
  });

  it("hides «Administración» from an active member without the raw 512 bit", async () => {
    for (const perms of ["0", String(CHANNELS), "64", String(CHANNELS | 64n | 256n)]) {
      expect(await isHiddenSettingsPage(client({ perms }) as never, "/foro/settings/administracion")).toBe(true);
    }
    expect(await isHiddenSettingsPage(client({ perms: String(SUPER) }) as never, "/foro/settings/administracion")).toBe(false);
  });

  it("only active members get the 404 (the layout redirects everyone else)", async () => {
    expect(await isHiddenSettingsPage(client({ perms: "0", status: "banned" }) as never, "/foro/settings/economia")).toBe(false);
  });

  it("fails open on any error (the page itself still calls notFound)", async () => {
    expect(await isHiddenSettingsPage(client({ permsError: { message: "x" }, perms: null }) as never, "/foro/settings/economia")).toBe(false);
    expect(await isHiddenSettingsPage(client({ perms: "0", statusError: { message: "x" } }) as never, "/foro/settings/economia")).toBe(false);
    expect(await isHiddenSettingsPage(client({ perms: "not a number" }) as never, "/foro/settings/economia")).toBe(false);
  });
});
