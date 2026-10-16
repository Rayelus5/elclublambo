import { describe, expect, it } from "vitest";
import { ALL_PERMS, CHANNEL_MASK, GLOBAL_MASK, Perm, hasPerm } from "@/lib/permissions/bits";

describe("Perm bits", () => {
  it("has exact values", () => {
    expect(Perm.VIEW_CHANNEL).toBe(1n);
    expect(Perm.SEND_MESSAGES).toBe(2n);
    expect(Perm.SEND_IN_THREADS).toBe(4n);
    expect(Perm.MANAGE_MESSAGES).toBe(8n);
    expect(Perm.CREATE_INVITES).toBe(16n);
    expect(Perm.BAN_MEMBERS).toBe(32n);
    expect(Perm.MANAGE_ROLES).toBe(64n);
    expect(Perm.MANAGE_CHANNELS).toBe(128n);
    expect(Perm.MANAGE_TREASURY).toBe(256n);
    expect(Perm.ADMINISTRATOR).toBe(512n);
    expect(Perm.ATTACH_FILES).toBe(1024n);
    expect(Perm.EMBED_LINKS).toBe(2048n);
    expect(Perm.MENTION_EVERYONE).toBe(4096n);
    expect(Perm.ADD_REACTIONS).toBe(8192n);
    expect(Perm.MANAGE_TICKETS).toBe(16384n);
    expect(Perm.VERIFY_MEMBERS).toBe(32768n);
    expect(Object.keys(Perm)).toHaveLength(16);
  });

  it("has exact masks", () => {
    expect(ALL_PERMS).toBe(65535n);
    expect(CHANNEL_MASK).toBe(31759n);
    expect(CHANNEL_MASK).toBe(1n | 2n | 4n | 8n | 1024n | 2048n | 4096n | 8192n | 16384n);
    expect(GLOBAL_MASK).toBe(ALL_PERMS & ~CHANNEL_MASK);
    expect(CHANNEL_MASK & GLOBAL_MASK).toBe(0n);
    expect(CHANNEL_MASK | GLOBAL_MASK).toBe(ALL_PERMS);
  });

  it("every bit is a distinct power of two inside ALL_PERMS", () => {
    const bits = Object.values(Perm);
    expect(new Set(bits).size).toBe(bits.length);
    for (const b of bits) {
      expect(b & (b - 1n)).toBe(0n);
      expect(b & ALL_PERMS).toBe(b);
    }
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
