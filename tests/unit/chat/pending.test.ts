import { describe, expect, it } from "vitest";
import { findLanded, pendingToMessage, settleOutcome, type PendingMessage } from "@/lib/chat/pending";
import { CHANNEL, doc, makeMessage, ME, OTHER } from "./fixtures";

function pending(over: Partial<PendingMessage> = {}): PendingMessage {
  return {
    key: "p-1",
    doc: doc("hola a todos"),
    text: "hola a todos",
    expanded: false,
    quotedId: null,
    quote: null,
    attachments: [],
    createdAt: new Date(Date.UTC(2026, 9, 18, 10, 0, 0)).toISOString(),
    seen: [],
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

describe("findLanded", () => {
  it("finds my message with the same text that was not on screen when I sent it", () => {
    const before = makeMessage({ authorId: ME, body: doc("hola a todos") });
    const landed = makeMessage({ authorId: ME, body: doc("hola a todos") });
    const p = pending({ seen: [before.id] });
    expect(findLanded(p, [before, landed], ME, new Set())?.id).toBe(landed.id);
  });

  it("ignores other authors, other texts, replies and messages already claimed by another send", () => {
    const p = pending();
    const other = makeMessage({ authorId: OTHER, body: doc("hola a todos") });
    const text = makeMessage({ authorId: ME, body: doc("otra cosa") });
    const reply = makeMessage({ authorId: ME, body: doc("hola a todos"), threadRootId: other.id });
    const claimed = makeMessage({ authorId: ME, body: doc("hola a todos") });
    expect(findLanded(p, [other, text, reply, claimed], ME, new Set([claimed.id]))).toBeUndefined();
  });

  it("needs the same number of images", () => {
    const p = pending({ attachments: [] });
    const withImage = makeMessage({ authorId: ME, body: doc("hola a todos"), attachments: [{ id: "x", url: null, mime: "image/png", width: null, height: null }] });
    expect(findLanded(p, [withImage], ME, new Set())).toBeUndefined();
  });
});
