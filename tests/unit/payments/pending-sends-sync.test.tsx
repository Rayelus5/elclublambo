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
const ENABLED = [84532, 421614] as const;
const intent = { id: "i", chainId: 84532, token: "USDC" as const, amount: "1", feeAmount: "0", recipientAddress: "0x1", platformAddress: null, expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString() };
const entry = (over: Partial<PendingSend> & Record<string, unknown>): PendingSend =>
  ({
    intentId: "i1",
    chainId: 84532,
    token: "USDC",
    targetType: "message",
    targetId: "t",
    feeRequired: false,
    createdAt: Date.now(),
    intent,
    ...over,
  }) as PendingSend;

const sync = () => render(<PendingSendsSync memberId={MEMBER} enabledChainIds={ENABLED} />);

beforeEach(() => {
  window.localStorage.clear();
  attachTxAction.mockReset().mockResolvedValue({ ok: true });
  verifyIntentAction.mockReset().mockResolvedValue({ status: "confirmed", tipId: "x" });
});

describe("PendingSendsSync", () => {
  it("attaches an unattached main hash, verifies once and drops a confirmed entry", async () => {
    upsertSend(MEMBER, entry({ mainHash: HASH_M }));
    sync();
    await waitFor(() => expect(loadSends(MEMBER)).toEqual([]));
    expect(attachTxAction).toHaveBeenCalledTimes(1);
    expect(attachTxAction).toHaveBeenCalledWith("i1", "main", HASH_M);
    expect(verifyIntentAction).toHaveBeenCalledWith("i1");
  });

  it("keeps a pending entry", async () => {
    upsertSend(MEMBER, entry({ intentId: "a", mainHash: HASH_M, mainAttached: true }));
    verifyIntentAction.mockResolvedValue({ status: "pending" });
    sync();
    await waitFor(() => expect(verifyIntentAction).toHaveBeenCalledTimes(1));
    expect(verifyIntentAction).toHaveBeenCalledWith("a");
    expect(loadSends(MEMBER).map((e) => e.intentId)).toEqual(["a"]);
  });

  it.each(["tx_mismatch", "tx_failed", "tx_too_old", "tx_already_used", "already_paid", "intent_expired", "forbidden", "not_found"])(
    "drops the entry on the definitive failure %s",
    async (code) => {
      upsertSend(MEMBER, entry({ intentId: "a", mainHash: HASH_M, mainAttached: true }));
      verifyIntentAction.mockResolvedValue({ status: "failed", code, error: "x" });
      sync();
      await waitFor(() => expect(loadSends(MEMBER)).toEqual([]));
    },
  );

  it.each(["unknown", "rpc_unavailable", "retry"])("keeps the entry on a non-definitive failure %s (F3-R3)", async (code) => {
    upsertSend(MEMBER, entry({ intentId: "a", mainHash: HASH_M, mainAttached: true }));
    verifyIntentAction.mockResolvedValue({ status: "failed", code, error: "x" });
    sync();
    await waitFor(() => expect(verifyIntentAction).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(loadSends(MEMBER)).toHaveLength(1);
  });

  it("keeps the entry when verification throws", async () => {
    upsertSend(MEMBER, entry({ intentId: "a", mainHash: HASH_M, mainAttached: true }));
    verifyIntentAction.mockRejectedValue(new Error("network"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    sync();
    await waitFor(() => expect(verifyIntentAction).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(loadSends(MEMBER)).toHaveLength(1);
    warn.mockRestore();
  });

  it("drops entries older than 7 days", () => {
    upsertSend(MEMBER, entry({ createdAt: Date.now() - 8 * 24 * 3600 * 1000, mainHash: HASH_M }));
    expect(loadSends(MEMBER)).toEqual([]);
  });
});

describe("PendingSendsSync (F3b-R5)", () => {
  it("picks up an entry left by closing during verification", async () => {
    upsertSend(MEMBER, entry({ mainHash: HASH_M, mainAttached: true }));
    sync();
    await waitFor(() => expect(verifyIntentAction).toHaveBeenCalledWith("i1"));
    expect(attachTxAction).not.toHaveBeenCalled();
    await waitFor(() => expect(loadSends(MEMBER)).toEqual([]));
  });

  it("a permanent attach error drops the entry and is not retried", async () => {
    attachTxAction.mockResolvedValue({ ok: false, code: "intent_expired", error: "x" });
    upsertSend(MEMBER, entry({ mainHash: HASH_M }));
    sync();
    await waitFor(() => expect(loadSends(MEMBER)).toEqual([]));
    expect(attachTxAction).toHaveBeenCalledTimes(1);
    expect(verifyIntentAction).not.toHaveBeenCalled();
  });

  it("keeps an entry on a transient attach error", async () => {
    attachTxAction.mockResolvedValue({ ok: false, code: "unknown", error: "x" });
    verifyIntentAction.mockResolvedValue({ status: "pending" });
    upsertSend(MEMBER, entry({ mainHash: HASH_M }));
    sync();
    await waitFor(() => expect(verifyIntentAction).toHaveBeenCalled());
    expect(loadSends(MEMBER)).toHaveLength(1);
  });

  it("keeps a fresh in-flight marker and drops a stale one", async () => {
    upsertSend(MEMBER, entry({ intentId: "wait", inFlight: Date.now() }));
    upsertSend(MEMBER, entry({ intentId: "stale", inFlight: Date.now() - 11 * 60_000 }));
    sync();
    await waitFor(() => expect(loadSends(MEMBER).map((e) => e.intentId)).toEqual(["wait"]));
  });
});

describe("PendingSendsSync leftovers (Review Focus 4)", () => {
  it("on mount drops fee-era entries and entries on a disabled chain without attaching or verifying them", async () => {
    upsertSend(MEMBER, entry({ intentId: "fee", feeRequired: true, feeHash: HASH_F, feeAttached: true }));
    upsertSend(MEMBER, entry({ intentId: "linea", chainId: 59141, mainHash: HASH_M }));
    upsertSend(MEMBER, entry({ intentId: "ok", mainHash: HASH_M, mainAttached: true }));
    verifyIntentAction.mockResolvedValue({ status: "pending" });
    sync();
    await waitFor(() => expect(verifyIntentAction).toHaveBeenCalledTimes(1));
    expect(verifyIntentAction).toHaveBeenCalledWith("ok");
    expect(attachTxAction).not.toHaveBeenCalled();
    expect(loadSends(MEMBER).map((e) => e.intentId)).toEqual(["ok"]);
  });
});
