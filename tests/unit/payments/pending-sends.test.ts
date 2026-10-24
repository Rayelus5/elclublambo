import { beforeEach, describe, expect, it } from "vitest";
import { findInFlight, loadSends, pruneUnsupportedSends, upsertSend, type PendingSend } from "@/lib/payments/pending-sends";

const MEMBER = "99999999-9999-4999-8999-999999999999";
const intent = { id: "i", chainId: 84532, token: "USDC" as const, amount: "1", feeAmount: "0", recipientAddress: "0x1", platformAddress: null, expiresAt: new Date(Date.now() + 3600_000).toISOString() };
const entry = (over: Partial<PendingSend> & Record<string, unknown>): PendingSend =>
  ({ intentId: "i1", chainId: 84532, token: "USDC", targetType: "message", targetId: "t", feeRequired: false, createdAt: Date.now(), intent, ...over }) as PendingSend;

beforeEach(() => window.localStorage.clear());

describe("pruneUnsupportedSends (Review Focus 4)", () => {
  it("drops entries that needed a fee or live on a chain outside the enabled ones, and says how many", () => {
    upsertSend(MEMBER, entry({ intentId: "fee", feeRequired: true, feeHash: `0x${"fe".repeat(32)}` }));
    upsertSend(MEMBER, entry({ intentId: "linea", chainId: 59141 }));
    upsertSend(MEMBER, entry({ intentId: "arb", chainId: 421614 }));
    upsertSend(MEMBER, entry({ intentId: "ok", chainId: 84532, mainHash: `0x${"aa".repeat(32)}` }));
    expect(pruneUnsupportedSends(MEMBER, [84532])).toBe(3);
    expect(loadSends(MEMBER).map((e) => e.intentId)).toEqual(["ok"]);
  });

  it("returns 0 and leaves the ledger alone when everything is supported", () => {
    upsertSend(MEMBER, entry({ intentId: "a" }));
    expect(pruneUnsupportedSends(MEMBER, [84532, 421614])).toBe(0);
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
