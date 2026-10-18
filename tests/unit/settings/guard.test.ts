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
  it.each(["/", "/settingsx", "/x/settings", "/c/abc"])("%s is not a settings page: no query", async (p) => {
    const c = client({});
    expect(await isHiddenSettingsPage(c as never, p)).toBe(false);
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it.each(["/settings", "/settings/", "/settings/economia", "/settings/roles"])("%s is hidden from a member with no settings section", async (p) => {
    expect(await isHiddenSettingsPage(client({ perms: "0" }) as never, p)).toBe(true);
  });

  it("hides a section the member lacks, even when another section is visible", async () => {
    const c = client({ perms: String(CHANNELS) });
    expect(await isHiddenSettingsPage(c as never, "/settings/economia")).toBe(true);
    expect(await isHiddenSettingsPage(c as never, "/settings/roles")).toBe(true);
    expect(await isHiddenSettingsPage(c as never, "/settings/channels")).toBe(false);
    expect(await isHiddenSettingsPage(c as never, "/settings")).toBe(false);
  });

  it("a MANAGE_ROLES-only delegate opens Roles and nothing else", async () => {
    const c = client({ perms: "64" });
    expect(await isHiddenSettingsPage(c as never, "/settings/roles")).toBe(false);
    expect(await isHiddenSettingsPage(c as never, "/settings")).toBe(false);
    for (const p of ["/settings/channels", "/settings/links", "/settings/economia"]) {
      expect(await isHiddenSettingsPage(c as never, p)).toBe(true);
    }
  });

  it("shows every section to the SuperAdmin; unknown subpaths are left to the router", async () => {
    const c = client({ perms: String(SUPER) });
    for (const p of ["/settings", "/settings/economia", "/settings/roles", "/settings/channels", "/settings/links", "/settings/nope"]) {
      expect(await isHiddenSettingsPage(c as never, p)).toBe(false);
    }
  });

  it("only active members get the 404 (the layout redirects everyone else)", async () => {
    expect(await isHiddenSettingsPage(client({ perms: "0", status: "banned" }) as never, "/settings/economia")).toBe(false);
  });

  it("fails open on any error (the page itself still calls notFound)", async () => {
    expect(await isHiddenSettingsPage(client({ permsError: { message: "x" }, perms: null }) as never, "/settings/economia")).toBe(false);
    expect(await isHiddenSettingsPage(client({ perms: "0", statusError: { message: "x" } }) as never, "/settings/economia")).toBe(false);
    expect(await isHiddenSettingsPage(client({ perms: "not a number" }) as never, "/settings/economia")).toBe(false);
  });
});
