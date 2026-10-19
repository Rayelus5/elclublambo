import { describe, expect, it } from "vitest";
import { CHANNEL_BIT_LIST, PERM_LABEL, SAFE_ROLE_MASK, SELECTABLE_BIT_LIST } from "@/lib/permissions/labels";
import { CHANNEL_MASK, Perm } from "@/lib/permissions/bits";
import { settingsSections } from "@/lib/permissions/settings";
import { cycleState, getState, setState } from "@/lib/permissions/overwrite-state";

describe("permission labels", () => {
  it("labels every bit except ADMINISTRATOR", () => {
    for (const [name, bit] of Object.entries(Perm)) {
      if (bit === Perm.ADMINISTRATOR) {
        expect(PERM_LABEL.has(bit)).toBe(false);
      } else {
        expect(PERM_LABEL.get(bit), name).toBeTruthy();
      }
    }
  });

  it("labels CREATE_BOUNTIES as Crear bounties", () => {
    expect(PERM_LABEL.get(Perm.CREATE_BOUNTIES)).toBe("Crear bounties");
  });

  it("labels CREATE_POLLS as Crear encuestas, right after Crear bounties", () => {
    expect(PERM_LABEL.get(Perm.CREATE_POLLS)).toBe("Crear encuestas");
    const i = CHANNEL_BIT_LIST.findIndex((b) => b.bit === Perm.CREATE_BOUNTIES);
    expect(CHANNEL_BIT_LIST[i + 1]).toEqual({ bit: Perm.CREATE_POLLS, label: "Crear encuestas" });
  });

  it("SAFE_ROLE_MASK matches the SQL member-safe mask 207895", () => {
    expect(SAFE_ROLE_MASK).toBe(207895n);
    expect(SAFE_ROLE_MASK & Perm.CREATE_POLLS).toBe(Perm.CREATE_POLLS);
  });

  it("exposes the 11 channel bits and 17 selectable bits", () => {
    expect(CHANNEL_BIT_LIST).toHaveLength(11);
    expect(CHANNEL_BIT_LIST.reduce((a, b) => a | b.bit, 0n)).toBe(CHANNEL_MASK);
    expect(SELECTABLE_BIT_LIST).toHaveLength(17);
    expect(SELECTABLE_BIT_LIST.some((b) => b.bit === Perm.ADMINISTRATOR)).toBe(false);
  });
});

describe("settingsSections gating", () => {
  const hrefs = (p: bigint) => settingsSections(p).map((s) => s.href);
  it("MANAGE_CHANNELS gives channels and links", () => {
    expect(hrefs(Perm.MANAGE_CHANNELS)).toEqual(["/settings/channels", "/settings/links"]);
  });
  it("MANAGE_ROLES gives roles", () => {
    expect(hrefs(Perm.MANAGE_ROLES)).toEqual(["/settings/roles"]);
  });
  it("ADMINISTRATOR gives everything", () => {
    expect(hrefs(Perm.ADMINISTRATOR)).toEqual([
      "/settings/channels",
      "/settings/roles",
      "/settings/links",
      "/settings/economia",
    ]);
  });
  it("economía needs bit 512 itself, not just other management bits", () => {
    expect(hrefs(Perm.MANAGE_CHANNELS | Perm.MANAGE_ROLES | Perm.MANAGE_TREASURY)).not.toContain("/settings/economia");
  });
  it("nothing gives nothing", () => {
    expect(hrefs(0n)).toEqual([]);
  });
});

describe("overwrite tri-state", () => {
  it("reads state from allow/deny", () => {
    expect(getState(1n, 0n, 1n)).toBe("allow");
    expect(getState(0n, 1n, 1n)).toBe("deny");
    expect(getState(0n, 0n, 1n)).toBe("inherit");
  });
  it("cycles inherit -> allow -> deny -> inherit", () => {
    expect(cycleState("inherit")).toBe("allow");
    expect(cycleState("allow")).toBe("deny");
    expect(cycleState("deny")).toBe("inherit");
  });
  it("sets state touching only that bit", () => {
    expect(setState(2n, 4n, 1n, "allow")).toEqual({ allow: 3n, deny: 4n });
    expect(setState(3n, 4n, 1n, "deny")).toEqual({ allow: 2n, deny: 5n });
    expect(setState(3n, 4n, 1n, "inherit")).toEqual({ allow: 2n, deny: 4n });
  });
});
