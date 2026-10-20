import { describe, expect, it } from "vitest";
import { isEchoOf, pendingToMessage, settleOutcome, type PendingMessage } from "@/lib/chat/pending";
import { CHANNEL, doc, makeMessage, ME, OTHER } from "./fixtures";

function pending(over: Partial<PendingMessage> = {}): PendingMessage {
  return {
    key: "p-1",
    doc: doc("hola a todos"),
    expanded: false,
    quotedId: null,
    quote: null,
    attachments: [],
    createdAt: new Date(Date.UTC(2026, 9, 18, 10, 0, 0)).toISOString(),
    status: "sending",
    ...over,
  };
}

describe("settleOutcome", () => {
  it("is sent with the new id", () => {
    expect(settleOutcome({ id: "m1" })).toEqual({ ok: true, id: "m1" });
  });

  it("a definite refusal of the server is safe to resend (nothing was written)", () => {
    expect(settleOutcome({ error: "slowmode" })).toEqual({ ok: false, outcome: "rejected", error: "slowmode" });
    expect(settleOutcome({ error: "rate_limited" })).toMatchObject({ outcome: "rejected" });
  });

  it("an unknown error or a thrown call may have been written: the outcome is unknown", () => {
    expect(settleOutcome({ error: "unknown" })).toMatchObject({ ok: false, outcome: "unknown" });
    expect(settleOutcome(null)).toMatchObject({ ok: false, outcome: "unknown", error: "unknown" });
    expect(settleOutcome({})).toMatchObject({ ok: false, outcome: "unknown" });
  });
});

describe("pendingToMessage", () => {
  it("builds my own message from the draft, with the local previews as attachments", () => {
    const m = pendingToMessage(
      pending({ attachments: [{ id: "a1", previewUrl: "blob:x", mime: "image/png", width: 10, height: 20, uploaded: { path: "p", mime: "image/png", size: 1, width: 10, height: 20 } }] }),
      ME,
      CHANNEL,
    );
    expect(m).toMatchObject({ id: "p-1", authorId: ME, channelId: CHANNEL, threadRootId: null, kind: "text", body: doc("hola a todos") });
    expect(m.attachments).toEqual([{ id: "a1", url: "blob:x", mime: "image/png", width: 10, height: 20 }]);
    expect(m.reactions).toEqual([]);
  });
});

describe("isEchoOf", () => {
  it("matches my message carrying the pending key, and nothing else", () => {
    const p = pending({ status: "failed", outcome: "unknown" });
    expect(isEchoOf(p, makeMessage({ authorId: ME, clientId: "p-1" }), ME)).toBe(true);
    expect(isEchoOf(p, makeMessage({ authorId: ME, clientId: "otra" }), ME)).toBe(false);
    expect(isEchoOf(p, makeMessage({ authorId: ME, clientId: null, body: doc("hola a todos") }), ME)).toBe(false);
    expect(isEchoOf(p, makeMessage({ authorId: OTHER, clientId: "p-1" }), ME)).toBe(false);
  });

  it("never matches a message the server refused (nothing was written)", () => {
    expect(isEchoOf(pending({ status: "failed", outcome: "rejected" }), makeMessage({ authorId: ME, clientId: "p-1" }), ME)).toBe(false);
  });
});
