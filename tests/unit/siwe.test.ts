import { afterEach, describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { APP_CHAINS, getAppChain } from "@/lib/web3/chains";
import { buildLoginMessage, generateNonce } from "@/lib/web3/siwe";

const lower = "0xd590d5d858d5b61c357e7a40ee6b6a72d938b82d" as Address;
const base = {
  address: lower,
  chainId: 59141,
  nonce: "abcdefgh12345678",
  domain: "localhost:3000",
  uri: "http://localhost:3000/login",
  now: new Date("2026-10-16T12:00:00.000Z"),
};

describe("buildLoginMessage", () => {
  it("rejects_foreign_chain", () => {
    expect(() => buildLoginMessage({ ...base, chainId: 1 })).toThrow("invalid_input");
  });

  it("message_contains_statement_and_bounds", () => {
    const msg = buildLoginMessage(base);
    const p = parseSiweMessage(msg);
    expect(p.chainId).toBe(59141);
    expect(p.statement).toBe("Entra en El Club Lambo. Esta firma no cuesta gas ni mueve fondos.");
    expect(p.notBefore!.getTime()).toBe(p.issuedAt!.getTime());
    expect(p.expirationTime!.getTime() - p.issuedAt!.getTime()).toBe(300000);
  });

  it("accepts_mainnet_linea", () => {
    expect(parseSiweMessage(buildLoginMessage({ ...base, chainId: 59144 })).chainId).toBe(59144);
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

describe("getAppChain", () => {
  const prev = process.env.NEXT_PUBLIC_CHAIN;
  afterEach(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_CHAIN;
    else process.env.NEXT_PUBLIC_CHAIN = prev;
  });

  it("defaults_to_linea_sepolia", () => {
    delete process.env.NEXT_PUBLIC_CHAIN;
    expect(getAppChain().id).toBe(59141);
  });
  it("selects_linea", () => {
    process.env.NEXT_PUBLIC_CHAIN = "linea";
    expect(getAppChain().id).toBe(59144);
  });
  it("throws_on_unknown", () => {
    process.env.NEXT_PUBLIC_CHAIN = "mainnet";
    expect(() => getAppChain()).toThrow();
  });
  it("throws_on_empty_string", () => {
    process.env.NEXT_PUBLIC_CHAIN = "";
    expect(() => getAppChain()).toThrow();
  });
  it("app_chains_are_exactly_two", () => {
    expect(APP_CHAINS.map((c) => c.id)).toEqual([59141, 59144]);
  });
});
