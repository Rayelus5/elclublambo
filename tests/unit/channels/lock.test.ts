import { describe, expect, it } from "vitest";
import {
  gatePercentToBps,
  lockRequirementText,
  lockSituationText,
  parseLockState,
  requirementText,
  type LockState,
} from "@/lib/channels/lock";

const base: LockState = {
  scope: "view",
  minShareBps: 100,
  minNetUsdc: 100_000_000n,
  myShareBps: 20,
  myNet: 20_000_000n,
  chainId: 59141,
  name: "Alpha",
  kind: "text",
  parentId: null,
  requirements: [{ channelId: "c1", scope: "view", minShareBps: 100, minNetUsdc: 100_000_000n }],
};

describe("lock copy", () => {
  it("both rules are joined with 'o', decimal comma", () => {
    expect(lockRequirementText(base)).toBe("Necesitas 1 % de la DAO o 100 USDC aportados");
    expect(requirementText({ minShareBps: 250, minNetUsdc: 1_500_000n })).toBe("Necesitas 2,5 % de la DAO o 1,5 USDC aportados");
  });
  it("share-only and net-only variants use only the rule that is set", () => {
    expect(requirementText({ minShareBps: 25, minNetUsdc: null })).toBe("Necesitas 0,25 % de la DAO");
    expect(requirementText({ minShareBps: null, minNetUsdc: 100_000_000n })).toBe("Necesitas 100 USDC aportados");
  });
  it("situation names the network", () => {
    expect(lockSituationText(base, "Linea Sepolia")).toBe("Tu situación: 0,2 % · 20 USDC aportados en Linea Sepolia");
  });
});

describe("parseLockState", () => {
  it("returns null for anything that is not a lock state", () => {
    expect(parseLockState(null)).toBeNull();
    expect(parseLockState("x")).toBeNull();
    expect(parseLockState({ scope: "edit" })).toBeNull();
  });
  it("parses the RPC json, numerics as bigint", () => {
    const s = parseLockState({
      scope: "view", minShareBps: 100, minNetUsdc: 100000000, myShareBps: 0, myNet: 0, chainId: 59141,
      name: "Alpha", kind: "text", parentId: null,
      requirements: [
        { channelId: "c0", scope: "view", minShareBps: 500, minNetUsdc: null },
        { channelId: "c1", scope: "view", minShareBps: null, minNetUsdc: 50000000 },
      ],
    });
    expect(s?.minNetUsdc).toBe(100_000_000n);
    expect(s?.requirements).toHaveLength(2);
    expect(s?.requirements[1]).toEqual({ channelId: "c1", scope: "view", minShareBps: null, minNetUsdc: 50_000_000n });
  });
  it("falls back to the top-level rule when the RPC predates requirements", () => {
    const s = parseLockState({ scope: "post", minShareBps: 100, minNetUsdc: null, myShareBps: 0, myNet: 0, chainId: 59141, name: "A", kind: "text", parentId: null });
    expect(s?.requirements).toEqual([{ channelId: null, scope: "post", minShareBps: 100, minNetUsdc: null }]);
  });
});

describe("gatePercentToBps", () => {
  it.each([
    ["1", 100], ["0,25", 25], ["12.5", 1250], ["100", 10000], ["0", 0], [" 2,05 ", 205],
  ])("%s -> %i", (text, bps) => expect(gatePercentToBps(text)).toBe(bps));
  it.each(["", "100,01", "101", "1,234", "-1", "abc", "1,"])("rejects %j", (text) => expect(gatePercentToBps(text)).toBeNull());
});
