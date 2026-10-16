import { describe, expect, it } from "vitest";
import { isSuperAdminWallet, normalizeAddress } from "@/lib/auth/wallet";

const CHECKSUM = "0x9F202eb556F95308de0268f60b5757d83744De02";

describe("normalizeAddress", () => {
  it("trims and lowercases", () => {
    expect(normalizeAddress(` ${CHECKSUM} `)).toBe(CHECKSUM.toLowerCase());
  });
  it("throws on invalid input", () => {
    expect(() => normalizeAddress("nope")).toThrow("invalid_input");
    expect(() => normalizeAddress("0x123")).toThrow("invalid_input");
  });
});

describe("isSuperAdminWallet", () => {
  const lower = CHECKSUM.toLowerCase();
  it("matches ignoring case and whitespace", () => {
    expect(isSuperAdminWallet(lower, ` ${CHECKSUM} `)).toBe(true);
    expect(isSuperAdminWallet(CHECKSUM, lower)).toBe(true);
  });
  it("is false for empty/undefined/invalid env", () => {
    expect(isSuperAdminWallet(lower, "")).toBe(false);
    expect(isSuperAdminWallet(lower, "   ")).toBe(false);
    expect(isSuperAdminWallet(lower, undefined)).toBe(false);
    expect(isSuperAdminWallet(lower, "garbage")).toBe(false);
  });
  it("is false for other or invalid address", () => {
    expect(isSuperAdminWallet("0x" + "1".repeat(40), CHECKSUM)).toBe(false);
    expect(isSuperAdminWallet("nope", CHECKSUM)).toBe(false);
  });
});
