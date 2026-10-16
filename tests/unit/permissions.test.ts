import { describe, expect, it } from "vitest";
import { ALL_PERMS, Perm, hasPerm } from "@/lib/permissions/bits";

describe("Perm bits", () => {
  it("has exact values", () => {
    expect(Perm.VIEW_CHANNEL).toBe(1n);
    expect(Perm.CREATE_THREADS).toBe(2n);
    expect(Perm.SEND_REPLIES).toBe(4n);
    expect(Perm.MANAGE_MESSAGES).toBe(8n);
    expect(Perm.CREATE_INVITES).toBe(16n);
    expect(Perm.BAN_MEMBERS).toBe(32n);
    expect(Perm.MANAGE_ROLES).toBe(64n);
    expect(Perm.MANAGE_CHANNELS).toBe(128n);
    expect(Perm.MANAGE_TREASURY).toBe(256n);
    expect(Perm.ADMINISTRATOR).toBe(512n);
    expect(ALL_PERMS).toBe(1023n);
  });
});

describe("hasPerm", () => {
  it("admin has every bit", () => {
    expect(hasPerm(512n, 16n)).toBe(true);
  });
  it("checks the bit otherwise", () => {
    expect(hasPerm(23n, 16n)).toBe(true);
    expect(hasPerm(7n, 16n)).toBe(false);
    expect(hasPerm(0n, 1n)).toBe(false);
  });
});
