import { describe, expect, it } from "vitest";
import { isSuperAdminWallet, normalizeAddress, shortAddress, walletFromUser } from "@/lib/auth/wallet";

describe("shortAddress", () => {
  it("shortens to 0x1234…abcd", () => {
    expect(shortAddress("0xD590d5D858d5B61C357e7a40Ee6b6a72D938b82d")).toBe("0xD590…b82d");
  });
});

describe("walletFromUser", () => {
  const A = "0x9F202eb556F95308de0268f60b5757d83744De02";
  const web3 = (data: Record<string, unknown> | null) => ({
    identities: [{ provider: "web3", identity_data: data }],
  });
  it("reads web3 identity custom_claims.address, normalized", () => {
    expect(walletFromUser(web3({ custom_claims: { address: A } }))).toBe(A.toLowerCase());
  });
  it("picks the earliest web3 identity by created_at (mirrors SQL)", () => {
    const B = "0x1111111111111111111111111111111111111111";
    const user = {
      identities: [
        { provider: "web3", created_at: "2026-02-01T00:00:00Z", identity_data: { custom_claims: { address: B } } },
        { provider: "web3", created_at: "2026-01-01T00:00:00Z", identity_data: { custom_claims: { address: A } } },
      ],
    };
    expect(walletFromUser(user)).toBe(A.toLowerCase());
  });
  it("returns null when absent, non-web3 or malformed", () => {
    expect(walletFromUser(null)).toBeNull();
    expect(walletFromUser({})).toBeNull();
    expect(walletFromUser({ identities: [] })).toBeNull();
    expect(
      walletFromUser({ identities: [{ provider: "email", identity_data: { custom_claims: { address: A } } }] }),
    ).toBeNull();
    expect(walletFromUser(web3(null))).toBeNull();
    expect(walletFromUser(web3({ custom_claims: {} }))).toBeNull();
    expect(walletFromUser(web3({ custom_claims: { address: "nope" } }))).toBeNull();
    expect(walletFromUser(web3({ custom_claims: { address: 5 } }))).toBeNull();
  });
});

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
