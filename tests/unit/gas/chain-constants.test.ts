// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import {
  GAS_ORACLE_WORD,
  GAS_PRICE_ORACLE as CHAIN_ORACLE,
  NODE_INTERFACE as CHAIN_NODE_INTERFACE,
  NODE_INTERFACE_L1_GAS,
} from "../../../e2e/chain/shared.mjs";
import { GAS_PRICE_ORACLE, NODE_INTERFACE } from "@/lib/gas/oracles-abi";

describe("local chain gas oracle constants (P6-R5b)", () => {
  it("match the app's (start-chain.mjs mocks exactly what the app reads)", () => {
    expect(CHAIN_ORACLE).toBe(GAS_PRICE_ORACLE);
    expect(CHAIN_NODE_INTERFACE).toBe(NODE_INTERFACE);
  });
  it("are checksummed predeploy addresses, with the agreed mock answers", () => {
    expect(getAddress(GAS_PRICE_ORACLE)).toBe(GAS_PRICE_ORACLE);
    expect(getAddress(NODE_INTERFACE)).toBe(NODE_INTERFACE);
    expect(GAS_ORACLE_WORD).toBe(2_000_000_000n);
    expect(NODE_INTERFACE_L1_GAS).toBe(1000n);
  });
});
