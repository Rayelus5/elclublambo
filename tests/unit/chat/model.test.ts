import { describe, expect, it } from "vitest";
import {
  aggregateReactions,
  applyToWindow,
  applyReactionToggle,
  firstUnreadIndex,
  isGrouped,
  removeById,
  upsertSorted,
  type ChatMessage,
} from "@/lib/chat/model";

const msg = (over: Partial<ChatMessage> & { id: string }): ChatMessage => ({
  channelId: "c",
  threadRootId: null,
  authorId: "a1",
  body: { type: "doc", content: [] },
  allowLinks: true,
  kind: "text",
  alphaAddress: null,
  expanded: false,
  quotedId: null,
  quote: null,
  replyCount: 0,
  lastReplyAt: null,
  pinnedAt: null,
  editedAt: null,
  deletedAt: null,
  createdAt: "2026-10-17T10:00:00.000000+00:00",
  attachments: [],
  reactions: [],
  ...over,
});

describe("aggregateReactions", () => {
  it("counts per emoji in first-appearance order and flags mine", () => {
    const rows = [
      { message_id: "m1", member_id: "me", emoji: "👍", created_at: "2026-10-17T10:00:00+00:00" },
      { message_id: "m1", member_id: "x", emoji: "🔥", created_at: "2026-10-17T10:00:01+00:00" },
      { message_id: "m1", member_id: "y", emoji: "👍", created_at: "2026-10-17T10:00:02+00:00" },
      { message_id: "m2", member_id: "x", emoji: "🎉", created_at: "2026-10-17T10:00:03+00:00" },
    ];
    const out = aggregateReactions(rows, "me");
    expect(out.get("m1")).toEqual([
      { emoji: "👍", count: 2, reactedByMe: true },
      { emoji: "🔥", count: 1, reactedByMe: false },
    ]);
    expect(out.get("m2")).toEqual([{ emoji: "🎉", count: 1, reactedByMe: false }]);
    expect(out.get("m3")).toBeUndefined();
  });
});

describe("applyReactionToggle", () => {
  const chips = [{ emoji: "👍", count: 2, reactedByMe: true }];
  it("removes my reaction and decrements", () => {
    expect(applyReactionToggle(chips, "👍")).toEqual([{ emoji: "👍", count: 1, reactedByMe: false }]);
  });
  it("drops the chip when I was the only one", () => {
    expect(applyReactionToggle([{ emoji: "👍", count: 1, reactedByMe: true }], "👍")).toEqual([]);
  });
  it("adds to an existing chip", () => {
    expect(applyReactionToggle([{ emoji: "👍", count: 2, reactedByMe: false }], "👍")).toEqual([
      { emoji: "👍", count: 3, reactedByMe: true },
    ]);
  });
  it("creates a new chip", () => {
    expect(applyReactionToggle(chips, "🔥")).toEqual([...chips, { emoji: "🔥", count: 1, reactedByMe: true }]);
  });
});

describe("isGrouped", () => {
  const a = msg({ id: "1", createdAt: "2026-10-17T10:00:00+00:00" });
  it("groups the same author within 5 minutes", () => {
    expect(isGrouped(a, msg({ id: "2", createdAt: "2026-10-17T10:04:59+00:00" }))).toBe(true);
  });
  it("does not group at 5 minutes or more", () => {
    expect(isGrouped(a, msg({ id: "2", createdAt: "2026-10-17T10:05:00+00:00" }))).toBe(false);
  });
  it("does not group different authors", () => {
    expect(isGrouped(a, msg({ id: "2", authorId: "a2", createdAt: "2026-10-17T10:01:00+00:00" }))).toBe(false);
  });
  it("does not group around deleted messages or quotes, nor without a previous one", () => {
    const at = "2026-10-17T10:01:00+00:00";
    expect(isGrouped(msg({ id: "0", deletedAt: at }), msg({ id: "2", createdAt: at }))).toBe(false);
    expect(isGrouped(a, msg({ id: "2", createdAt: at, deletedAt: at }))).toBe(false);
    expect(isGrouped(a, msg({ id: "2", createdAt: at, quotedId: "9" }))).toBe(false);
    expect(isGrouped(undefined, a)).toBe(false);
  });
});

describe("upsertSorted / removeById", () => {
  const m1 = msg({ id: "1", createdAt: "2026-10-17T10:00:00.000001+00:00" });
  const m2 = msg({ id: "2", createdAt: "2026-10-17T10:00:00.000002+00:00" });
  const m3 = msg({ id: "3", createdAt: "2026-10-17T10:00:01+00:00" });

  it("inserts in (created_at, id) order", () => {
    expect(upsertSorted([m1, m3], m2).map((m) => m.id)).toEqual(["1", "2", "3"]);
  });
  it("breaks created_at ties by id", () => {
    const tie = msg({ id: "0", createdAt: m1.createdAt });
    expect(upsertSorted([m1], tie).map((m) => m.id)).toEqual(["0", "1"]);
  });
  it("replaces an existing id in place without duplicating", () => {
    const edited = { ...m2, editedAt: "2026-10-17T11:00:00+00:00" };
    const out = upsertSorted([m1, m2, m3], edited);
    expect(out).toHaveLength(3);
    expect(out[1]!.editedAt).toBe("2026-10-17T11:00:00+00:00");
  });
  it("removes by id", () => {
    expect(removeById([m1, m2], "1").map((m) => m.id)).toEqual(["2"]);
    expect(removeById([m1], "zzz")).toHaveLength(1);
  });
});

describe("firstUnreadIndex", () => {
  const list = [
    msg({ id: "1", createdAt: "2026-10-17T10:00:00+00:00" }),
    msg({ id: "2", createdAt: "2026-10-17T10:10:00+00:00", authorId: "me" }),
    msg({ id: "3", createdAt: "2026-10-17T10:20:00+00:00" }),
  ];
  it("is the first message newer than the read mark written by someone else", () => {
    expect(firstUnreadIndex(list, "2026-10-17T10:05:00+00:00", "me")).toBe(2);
  });
  it("is -1 without a mark, when everything is read, or when only my messages are newer", () => {
    expect(firstUnreadIndex(list, null, "me")).toBe(-1);
    expect(firstUnreadIndex(list, "2026-10-17T11:00:00+00:00", "me")).toBe(-1);
    expect(firstUnreadIndex(list.slice(0, 2), "2026-10-17T10:05:00+00:00", "me")).toBe(-1);
  });
});

describe("applyToWindow", () => {
  const old = msg({ id: "1", createdAt: "2026-10-17T09:00:00+00:00" });
  const first = msg({ id: "2", createdAt: "2026-10-17T10:00:00+00:00" });
  const newer = msg({ id: "3", createdAt: "2026-10-17T11:00:00+00:00" });

  it("appends a new message", () => {
    expect(applyToWindow([first], newer, true).map((m) => m.id)).toEqual(["2", "3"]);
  });
  it("updates a loaded message in place", () => {
    const edited = { ...first, editedAt: "2026-10-17T12:00:00+00:00" };
    expect(applyToWindow([first, newer], edited, true)[0]!.editedAt).toBe("2026-10-17T12:00:00+00:00");
  });
  it("ignores a message older than the window while more history exists", () => {
    expect(applyToWindow([first], old, true).map((m) => m.id)).toEqual(["2"]);
  });
  it("inserts an older message when the whole history is loaded", () => {
    expect(applyToWindow([first], old, false).map((m) => m.id)).toEqual(["1", "2"]);
  });
});
