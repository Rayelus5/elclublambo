// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EAS_ADDRESS as CHAIN_EAS, SCHEMA_REGISTRY_ADDRESS as CHAIN_REGISTRY, VOUCH_SCHEMA as CHAIN_SCHEMA } from "../../../e2e/chain/shared.mjs";
import { EAS_ADDRESS, SCHEMA_REGISTRY_ADDRESS, VOUCH_SCHEMA } from "@/lib/vouches/eas";

describe("local chain EAS constants", () => {
  it("match the app's (start-chain.mjs registers exactly what the app reads)", () => {
    expect(CHAIN_SCHEMA).toBe(VOUCH_SCHEMA);
    expect(CHAIN_EAS).toBe(EAS_ADDRESS);
    expect(CHAIN_REGISTRY).toBe(SCHEMA_REGISTRY_ADDRESS);
  });
});
