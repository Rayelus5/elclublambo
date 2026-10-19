import { beforeEach, describe, expect, it } from "vitest";
import { MAX_TRACKED_MEMBERS, RECHECK_EVERY_MS, resetRecheckThrottle, shouldRecheckMember } from "@/lib/payments/recheck-throttle";

const T0 = 1_000_000;

describe("shouldRecheckMember (F5 S2: reload spam cannot amplify RPC spend)", () => {
  beforeEach(() => resetRecheckThrottle());

  it("lets the first request through and throttles the next ones inside the window", () => {
    expect(shouldRecheckMember("m1", T0)).toBe(true);
    expect(shouldRecheckMember("m1", T0 + 1)).toBe(false);
    expect(shouldRecheckMember("m1", T0 + RECHECK_EVERY_MS - 1)).toBe(false);
    expect(shouldRecheckMember("m1", T0 + RECHECK_EVERY_MS)).toBe(true);
  });

  it("throttles each member independently", () => {
    expect(shouldRecheckMember("m1", T0)).toBe(true);
    expect(shouldRecheckMember("m2", T0)).toBe(true);
    expect(shouldRecheckMember("m1", T0 + 5)).toBe(false);
  });

  it("is a window of at most 30 s, so the interrupted-payment recovery still runs within a minute", () => {
    expect(RECHECK_EVERY_MS).toBeLessThanOrEqual(30_000);
    expect(RECHECK_EVERY_MS).toBeGreaterThanOrEqual(10_000);
  });

  it("keeps its memory bounded and still throttles a member just seen", () => {
    for (let i = 0; i < MAX_TRACKED_MEMBERS + 50; i++) shouldRecheckMember(`m${i}`, T0);
    const last = `m${MAX_TRACKED_MEMBERS + 49}`;
    expect(shouldRecheckMember(last, T0 + 1)).toBe(false);
  });
});
