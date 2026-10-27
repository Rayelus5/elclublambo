import { describe, expect, it } from "vitest";
import {
  lockSituationText,
  lockText,
  parseLockState,
  requirementText,
  usdToUsd6,
  type LockState,
} from "@/lib/channels/lock";

const base: LockState = {
  scope: "view",
  minDonatedUsd6: 10_000_000n,
  myDonatedUsd6: 9_990_000n,
  name: "Alpha",
  kind: "text",
  parentId: null,
  requirements: [{ channelId: "c1", scope: "view", minDonatedUsd6: 10_000_000n }],
};

describe("lock copy", () => {
  it("the lock text names the minimum and what the member has donated", () => {
    expect(lockText(base)).toBe("Canal para quien ha donado al menos 10 USD. Llevas 9,99 USD.");
  });
  it("requirement and situation are separate sentences for nested gates", () => {
    expect(requirementText({ minDonatedUsd6: 2_500_000n })).toBe("Canal para quien ha donado al menos 2,5 USD.");
    expect(lockSituationText(base)).toBe("Llevas 9,99 USD.");
    expect(lockSituationText({ ...base, myDonatedUsd6: 0n })).toBe("Llevas 0 USD.");
  });
  it("groups thousands", () => {
    expect(requirementText({ minDonatedUsd6: 1_500_000_000n })).toBe("Canal para quien ha donado al menos 1.500 USD.");
  });
});

describe("parseLockState", () => {
  it("returns null for anything that is not a lock state", () => {
    expect(parseLockState(null)).toBeNull();
    expect(parseLockState("x")).toBeNull();
    expect(parseLockState({ scope: "edit" })).toBeNull();
    expect(parseLockState({ scope: "view", name: "A", kind: "text", minDonatedUsd6: "x", myDonatedUsd6: "0" })).toBeNull();
  });
  it("parses the RPC json: usd6 amounts travel as text and become bigint", () => {
    const s = parseLockState({
      scope: "view", minDonatedUsd6: "5000000", myDonatedUsd6: "123456789012345678901",
      name: "Alpha", kind: "text", parentId: null,
      requirements: [
        { channelId: "c0", scope: "view", minDonatedUsd6: "5000000" },
        { channelId: "c1", scope: "view", minDonatedUsd6: "50000000" },
      ],
    });
    expect(s?.minDonatedUsd6).toBe(5_000_000n);
    expect(s?.myDonatedUsd6).toBe(123_456_789_012_345_678_901n);
    expect(s?.requirements).toHaveLength(2);
    expect(s?.requirements[1]).toEqual({ channelId: "c1", scope: "view", minDonatedUsd6: 50_000_000n });
  });
  it("a requirement without a readable amount is dropped; none left -> null", () => {
    expect(
      parseLockState({
        scope: "post", minDonatedUsd6: "1", myDonatedUsd6: "0", name: "A", kind: "text", parentId: null,
        requirements: [{ channelId: "c", scope: "post", minDonatedUsd6: null }],
      }),
    ).toBeNull();
  });
  it("falls back to the top-level rule when requirements is missing", () => {
    const s = parseLockState({ scope: "post", minDonatedUsd6: "1000000", myDonatedUsd6: "0", name: "A", kind: "text", parentId: null });
    expect(s?.requirements).toEqual([{ channelId: null, scope: "post", minDonatedUsd6: 1_000_000n }]);
  });
});

describe("usdToUsd6", () => {
  it.each([
    ["10", 10_000_000n], ["0,5", 500_000n], ["12.25", 12_250_000n], ["0", 0n], [" 7 ", 7_000_000n],
    ["123456789012345678901234", 123456789012345678901234n * 1_000_000n],
  ])("%s -> %s", (text, usd6) => expect(usdToUsd6(text)).toBe(usd6));
  it.each(["", "-1", "abc", "1,1234567", "1,", ".5"])("rejects %j", (text) => expect(usdToUsd6(text)).toBeNull());
});
