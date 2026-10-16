import { describe, expect, it } from "vitest";
import { computeChannelPermissions } from "@/lib/permissions/channel";
import { cases, toInput } from "../fixtures/channel-cases";

describe("computeChannelPermissions (shared fixtures)", () => {
  it("has at least 14 cases including the review-focus ones", () => {
    expect(cases.length).toBeGreaterThanOrEqual(14);
    const names = cases.map((c) => c.name);
    expect(names).toContain("hidden_ancestor_beats_descendant_allow");
    expect(names).toContain("penalty_allow_cannot_reveal");
  });

  for (const c of cases) {
    it(c.name, () => {
      expect(computeChannelPermissions(toInput(c))).toBe(BigInt(c.expected));
    });
  }
});
