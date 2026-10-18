import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const attachTxAction = vi.hoisted(() => vi.fn());
const verifyIntentAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/tip-actions", () => ({ attachTxAction, verifyIntentAction }));

import { PendingSendsSync } from "@/components/payments/pending-sends-sync";
import { loadSends, upsertSend, type PendingSend } from "@/lib/payments/pending-sends";

const MEMBER = "99999999-9999-4999-8999-999999999999";
const HASH_F = "0x" + "fe".repeat(32);
const HASH_M = "0x" + "aa".repeat(32);
const intent = { id: "i", chainId: 59141, token: "USDC" as const, amount: "1", feeAmount: "1", recipientAddress: "0x1", platformAddress: "0x2", expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString() };
const entry = (over: Partial<PendingSend>): PendingSend => ({
  intentId: "i1",
  chainId: 59141,
  token: "USDC",
  targetType: "message",
  targetId: "t",
  feeRequired: true,
  createdAt: Date.now(),
  intent,
  ...over,
});

beforeEach(() => {
  window.localStorage.clear();
  attachTxAction.mockReset().mockResolvedValue({ ok: true });
  verifyIntentAction.mockReset().mockResolvedValue({ status: "confirmed", tipId: "x" });
});

describe("PendingSendsSync", () => {
  it("attaches unattached hashes, verifies once and drops a confirmed entry", async () => {
    upsertSend(MEMBER, entry({ feeHash: HASH_F, feeAttached: true, mainHash: HASH_M }));
    render(<PendingSendsSync memberId={MEMBER} />);
    await waitFor(() => expect(loadSends(MEMBER)).toEqual([]));
    expect(attachTxAction).toHaveBeenCalledTimes(1);
    expect(attachTxAction).toHaveBeenCalledWith("i1", "main", HASH_M);
    expect(verifyIntentAction).toHaveBeenCalledWith("i1");
  });

  it("keeps a pending entry and one whose tip was never signed", async () => {
    upsertSend(MEMBER, entry({ intentId: "a", mainHash: HASH_M, mainAttached: true, feeHash: HASH_F, feeAttached: true }));
    upsertSend(MEMBER, entry({ intentId: "b", feeHash: HASH_F, feeAttached: true }));
    verifyIntentAction.mockResolvedValue({ status: "pending" });
    render(<PendingSendsSync memberId={MEMBER} />);
    await waitFor(() => expect(verifyIntentAction).toHaveBeenCalledTimes(1));
    expect(verifyIntentAction).toHaveBeenCalledWith("a");
    expect(loadSends(MEMBER).map((e) => e.intentId).sort()).toEqual(["a", "b"]);
  });

  it("drops a failed entry and survives a thrown action", async () => {
    upsertSend(MEMBER, entry({ intentId: "a", mainHash: HASH_M, mainAttached: true, feeHash: HASH_F, feeAttached: true }));
    verifyIntentAction.mockResolvedValue({ status: "failed", code: "tx_mismatch", error: "x" });
    render(<PendingSendsSync memberId={MEMBER} />);
    await waitFor(() => expect(loadSends(MEMBER)).toEqual([]));
  });

  it("drops entries older than 7 days", () => {
    upsertSend(MEMBER, entry({ createdAt: Date.now() - 8 * 24 * 3600 * 1000, mainHash: HASH_M }));
    expect(loadSends(MEMBER)).toEqual([]);
  });
});

describe("PendingSendsSync (F3b-R5)", () => {
  it("picks up an entry left by closing during verification", async () => {
    upsertSend(MEMBER, entry({ feeHash: HASH_F, feeAttached: true, mainHash: HASH_M, mainAttached: true }));
    render(<PendingSendsSync memberId={MEMBER} />);
    await waitFor(() => expect(verifyIntentAction).toHaveBeenCalledWith("i1"));
    expect(attachTxAction).not.toHaveBeenCalled();
    await waitFor(() => expect(loadSends(MEMBER)).toEqual([]));
  });

  it("a permanent attach error drops the entry and is not retried", async () => {
    attachTxAction.mockResolvedValue({ ok: false, code: "intent_expired", error: "x" });
    upsertSend(MEMBER, entry({ mainHash: HASH_M, feeHash: HASH_F, feeAttached: true }));
    render(<PendingSendsSync memberId={MEMBER} />);
    await waitFor(() => expect(loadSends(MEMBER)).toEqual([]));
    expect(attachTxAction).toHaveBeenCalledTimes(1);
    expect(verifyIntentAction).not.toHaveBeenCalled();
  });

  it("keeps an entry on a transient attach error", async () => {
    attachTxAction.mockResolvedValue({ ok: false, code: "unknown", error: "x" });
    verifyIntentAction.mockResolvedValue({ status: "pending" });
    upsertSend(MEMBER, entry({ mainHash: HASH_M, feeHash: HASH_F, feeAttached: true }));
    render(<PendingSendsSync memberId={MEMBER} />);
    await waitFor(() => expect(verifyIntentAction).toHaveBeenCalled());
    expect(loadSends(MEMBER)).toHaveLength(1);
  });

  it("drops a fee-only entry once its intent expired, and keeps a fresh in-flight marker", async () => {
    upsertSend(MEMBER, entry({ intentId: "old", feeHash: HASH_F, intent: { ...intent, expiresAt: new Date(Date.now() - 1000).toISOString() } }));
    upsertSend(MEMBER, entry({ intentId: "wait", inFlight: Date.now() }));
    upsertSend(MEMBER, entry({ intentId: "stale", inFlight: Date.now() - 11 * 60_000 }));
    render(<PendingSendsSync memberId={MEMBER} />);
    await waitFor(() => expect(loadSends(MEMBER).map((e) => e.intentId)).toEqual(["wait"]));
  });
});
