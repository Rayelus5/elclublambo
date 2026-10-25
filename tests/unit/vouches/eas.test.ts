import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { zeroAddress, zeroHash } from "viem";
import {
  attestArgs,
  decodeVouchData,
  EAS_ADDRESS,
  easAddresses,
  easscanUrl,
  encodeVouchData,
  isVouchChain,
  revokeArgs,
  SCHEMA_REGISTRY_ADDRESS,
  vouchChain,
  vouchSchemaUid,
  VOUCH_SCHEMA_UID,
} from "@/lib/vouches/eas";
import { isVouchKind, vouchKindKey } from "@/lib/vouches/kinds";

const req = createRequire(import.meta.url);
const pkg = "@ethereum-attestation-service/eas-contracts/deployments";
const OVERRIDE = "0x1111111111111111111111111111111111111111";

describe("vouch schema", () => {
  it("pins the schema UID", () => {
    expect(vouchSchemaUid()).toBe("0xb3d93d8e864b16464af09e79542423fc8c7b29f4aff58fc2dc39c48abf34279c");
    expect(VOUCH_SCHEMA_UID).toBe(vouchSchemaUid());
  });
  it("changes with the resolver or revocability", () => {
    expect(vouchSchemaUid("uint8 kind", zeroAddress, false)).not.toBe(VOUCH_SCHEMA_UID);
  });
});

describe("predeploy addresses", () => {
  it.each(["base", "base-sepolia"])("match the package deployments on %s", (dir) => {
    expect(req(`${pkg}/${dir}/EAS.json`).address).toBe(EAS_ADDRESS);
    expect(req(`${pkg}/${dir}/SchemaRegistry.json`).address).toBe(SCHEMA_REGISTRY_ADDRESS);
  });
});

describe("easAddresses (P5-R9 fallback)", () => {
  it("returns the predeploys by default", () => {
    expect(easAddresses({})).toEqual({ eas: EAS_ADDRESS, registry: SCHEMA_REGISTRY_ADDRESS });
  });
  it("ignores the override on mainnet", () => {
    expect(easAddresses({ NEXT_PUBLIC_NETWORK_SET: "mainnet", NEXT_PUBLIC_EAS_ADDRESS: OVERRIDE, NEXT_PUBLIC_EAS_REGISTRY_ADDRESS: OVERRIDE })).toEqual({
      eas: EAS_ADDRESS,
      registry: SCHEMA_REGISTRY_ADDRESS,
    });
  });
  it("uses valid overrides on testnet", () => {
    expect(easAddresses({ NEXT_PUBLIC_NETWORK_SET: "testnet", NEXT_PUBLIC_EAS_ADDRESS: OVERRIDE })).toEqual({ eas: OVERRIDE, registry: SCHEMA_REGISTRY_ADDRESS });
  });
  it("ignores invalid overrides on testnet", () => {
    expect(easAddresses({ NEXT_PUBLIC_NETWORK_SET: "testnet", NEXT_PUBLIC_EAS_ADDRESS: "nope", NEXT_PUBLIC_EAS_REGISTRY_ADDRESS: "0x12" })).toEqual({
      eas: EAS_ADDRESS,
      registry: SCHEMA_REGISTRY_ADDRESS,
    });
  });
});

describe("vouch data", () => {
  it("round-trips the kind", () => {
    expect(decodeVouchData(encodeVouchData(2))).toBe(2);
  });
  it("returns null for data that is not a uint8", () => {
    expect(decodeVouchData("0x")).toBeNull();
    expect(decodeVouchData(`0x${"00".repeat(64)}`)).toBeNull();
    expect(decodeVouchData(`0x${"00".repeat(31)}ff`)).toBe(255);
    expect(decodeVouchData(`0x${"00".repeat(30)}0100`)).toBeNull(); // 256 does not fit a uint8
  });
});

describe("write args", () => {
  const to = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
  it("attestArgs", () => {
    expect(attestArgs(to, 1)).toEqual([
      { schema: VOUCH_SCHEMA_UID, data: { recipient: to, expirationTime: 0n, revocable: true, refUID: zeroHash, data: encodeVouchData(1), value: 0n } },
    ]);
  });
  it("revokeArgs", () => {
    const uid = `0x${"ab".repeat(32)}` as const;
    expect(revokeArgs(uid)).toEqual([{ schema: VOUCH_SCHEMA_UID, data: { uid, value: 0n } }]);
  });
});

describe("chain and links", () => {
  it("vouchChain is Base for the build's set", () => {
    expect(isVouchChain(vouchChain())).toBe(true);
    expect([8453, 84532]).toContain(vouchChain());
  });
  it("isVouchChain rejects others", () => {
    expect(isVouchChain(8453)).toBe(true);
    expect(isVouchChain(84532)).toBe(true);
    expect(isVouchChain(42161)).toBe(false);
    expect(isVouchChain("8453")).toBe(false);
  });
  it("easscanUrl", () => {
    expect(easscanUrl(84532, "0xabc")).toBe("https://base-sepolia.easscan.org/attestation/view/0xabc");
    expect(easscanUrl(8453, "0xabc")).toBe("https://base.easscan.org/attestation/view/0xabc");
  });
});

describe("kinds", () => {
  it("maps keys; unknown is other", () => {
    expect(vouchKindKey(1)).toBe("in_person");
    expect(vouchKindKey(2)).toBe("worked_together");
    expect(vouchKindKey(3)).toBe("reliable_trade");
    expect(vouchKindKey(7)).toBe("other");
  });
  it("isVouchKind", () => {
    expect(isVouchKind(3)).toBe(true);
    expect(isVouchKind(4)).toBe(false);
    expect(isVouchKind("1")).toBe(false);
  });
});
