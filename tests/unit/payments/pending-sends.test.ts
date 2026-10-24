import { beforeEach, describe, expect, it } from "vitest";
import { findInFlight, loadSends, pruneUnsupportedSends, upsertSend, type PendingSend } from "@/lib/payments/pending-sends";

const MEMBER = "99999999-9999-4999-8999-999999999999";
const intent = { id: "i", chainId: 84532, token: "USDC" as const, amount: "1", feeAmount: "0", recipientAddress: "0x1", platformAddress: null, expiresAt: new Date(Date.now() + 3600_000).toISOString() };
const entry = (over: Partial<PendingSend> & Record<string, unknown>): PendingSend =>
  ({ intentId: "i1", chainId: 84532, token: "USDC", targetType: "message", targetId: "t", feeRequired: false, createdAt: Date.now(), intent, ...over }) as PendingSend;

beforeEach(() => window.localStorage.clear());

describe("pruneUnsupportedSends (Review Focus 4)", () => {
  const HASH = `0x${"aa".repeat(32)}`;

  it("drops unsigned entries of the fee era or on a chain outside the build set, and says how many", () => {
    upsertSend(MEMBER, entry({ intentId: "fee", feeRequired: true }));
    upsertSend(MEMBER, entry({ intentId: "linea", chainId: 59141 }));
    upsertSend(MEMBER, entry({ intentId: "arb", chainId: 421614 }));
    upsertSend(MEMBER, entry({ intentId: "ok", chainId: 84532 }));
    expect(pruneUnsupportedSends(MEMBER)).toBe(2);
    expect(loadSends(MEMBER).map((e) => e.intentId)).toEqual(["arb", "ok"]);
  });

  it("never drops an entry with a signed main hash, even outside the build set or from the fee era", () => {
    upsertSend(MEMBER, entry({ intentId: "fee", feeRequired: true, mainHash: HASH }));
    upsertSend(MEMBER, entry({ intentId: "linea", chainId: 59141, mainHash: HASH }));
    expect(pruneUnsupportedSends(MEMBER)).toBe(0);
    expect(loadSends(MEMBER).map((e) => e.intentId)).toEqual(["fee", "linea"]);
  });

  it("keeps a signed entry on a chain the SuperAdmin disabled (the DB switch is not consulted)", () => {
    upsertSend(MEMBER, entry({ intentId: "disabled", chainId: 421614, mainHash: HASH }));
    upsertSend(MEMBER, entry({ intentId: "unsigned", chainId: 421614 }));
    expect(pruneUnsupportedSends(MEMBER)).toBe(0);
    expect(loadSends(MEMBER)).toHaveLength(2);
  });

  it("returns 0 and leaves the ledger alone when everything is supported", () => {
    upsertSend(MEMBER, entry({ intentId: "a" }));
    expect(pruneUnsupportedSends(MEMBER)).toBe(0);
    expect(loadSends(MEMBER)).toHaveLength(1);
  });
});

describe("findInFlight", () => {
  it("finds a recent pending signature for the target only", () => {
    upsertSend(MEMBER, entry({ inFlight: Date.now() }));
    expect(findInFlight(MEMBER, "message", "t")?.intentId).toBe("i1");
    expect(findInFlight(MEMBER, "message", "other")).toBeUndefined();
    expect(findInFlight(MEMBER, "bounty", "t")).toBeUndefined();
  });
});
