import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, type Address } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { appChains } from "@/lib/web3/chains";
import { buildLoginMessage, generateNonce } from "@/lib/web3/siwe";

const lower = "0xd590d5d858d5b61c357e7a40ee6b6a72d938b82d" as Address;
const base = {
  address: lower,
  chainId: 84532,
  nonce: "abcdefgh12345678",
  domain: "localhost:3000",
  uri: "http://localhost:3000/login",
  now: new Date("2026-10-16T12:00:00.000Z"),
};

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet"));
afterEach(() => vi.unstubAllEnvs());

describe("buildLoginMessage", () => {
  it("rejects_foreign_chain", () => {
    expect(() => buildLoginMessage({ ...base, chainId: 1 })).toThrow("invalid_input");
  });

  // Linea (legacy) and the other set's chains are not login chains.
  it.each([59141, 59144, 8453, 42161])("rejects_chain_outside_the_set_%i", (chainId) => {
    expect(() => buildLoginMessage({ ...base, chainId })).toThrow("invalid_input");
  });

  it.each([84532, 421614])("accepts_testnet_chain_%i", (chainId) => {
    expect(parseSiweMessage(buildLoginMessage({ ...base, chainId })).chainId).toBe(chainId);
  });

  it("accepts_mainnet_chains_with_the_mainnet_set", () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "mainnet");
    expect(parseSiweMessage(buildLoginMessage({ ...base, chainId: 8453 })).chainId).toBe(8453);
    expect(parseSiweMessage(buildLoginMessage({ ...base, chainId: 42161 })).chainId).toBe(42161);
    expect(() => buildLoginMessage(base)).toThrow("invalid_input");
  });

  it("message_contains_statement_and_bounds", () => {
    const msg = buildLoginMessage(base);
    const p = parseSiweMessage(msg);
    expect(p.chainId).toBe(84532);
    expect(p.statement).toBe("Entra en El Club Lambo. Esta firma no cuesta gas ni mueve fondos.");
    expect(p.notBefore!.getTime()).toBe(p.issuedAt!.getTime());
    expect(p.expirationTime!.getTime() - p.issuedAt!.getTime()).toBe(300000);
  });

  it("address_is_checksummed", () => {
    const p = parseSiweMessage(buildLoginMessage(base));
    expect(p.address).toBe(getAddress(lower));
    expect(p.address).not.toBe(lower);
  });
});

describe("generateNonce", () => {
  it("returns_alphanumeric_nonce", () => {
    expect(generateNonce()).toMatch(/^[a-zA-Z0-9]{8,}$/);
  });
});

describe("appChains", () => {
  it("testnet_set_is_base_sepolia_then_arbitrum_sepolia", () => {
    expect(appChains().map((c) => c.id)).toEqual([84532, 421614]);
  });
  it("defaults_to_testnet_when_unset", () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "");
    expect(appChains().map((c) => c.id)).toEqual([84532, 421614]);
  });
  it("mainnet_set_is_base_then_arbitrum", () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "mainnet");
    expect(appChains().map((c) => c.id)).toEqual([8453, 42161]);
  });
  it("throws_on_unknown_set", () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "linea");
    expect(() => appChains()).toThrow();
  });
});
