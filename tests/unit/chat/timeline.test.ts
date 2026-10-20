import { describe, expect, it } from "vitest";
import { buildTimeline, dayKey, dayLabel, isArrival } from "@/lib/chat/timeline";
import { countUnseen, decideScroll, isNearBottom, newMessagesLabel } from "@/lib/chat/scroll";
import { makeMessage, ME, OTHER } from "./fixtures";

const utc = (d: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, d, h, m, 0)).toISOString();

describe("dayKey", () => {
  it("is the calendar day of the instant in the given time zone", () => {
    // 23:30 UTC on the 17th is already the 18th in Madrid (UTC+2 in October) and still the 17th in New York.
    expect(dayKey(utc(17, 23, 30), "UTC")).toBe("2026-10-17");
    expect(dayKey(utc(17, 23, 30), "Europe/Madrid")).toBe("2026-10-18");
    expect(dayKey(utc(18, 2, 0), "America/New_York")).toBe("2026-10-17");
  });

  it("is null for an unparseable timestamp", () => {
    expect(dayKey("not a date", "UTC")).toBeNull();
  });
});

describe("dayLabel", () => {
  it("says Hoy and Ayer for the last two days", () => {
    expect(dayLabel("2026-10-20", "2026-10-20")).toBe("Hoy");
    expect(dayLabel("2026-10-19", "2026-10-20")).toBe("Ayer");
  });

  it("crosses month and year boundaries for Ayer", () => {
    expect(dayLabel("2026-09-30", "2026-10-01")).toBe("Ayer");
    expect(dayLabel("2025-12-31", "2026-01-01")).toBe("Ayer");
  });

  it("writes the day and month in Spanish within the current year", () => {
    expect(dayLabel("2026-10-12", "2026-10-20")).toBe("12 de octubre");
    expect(dayLabel("2026-01-01", "2026-10-20")).toBe("1 de enero");
  });

  it("adds the year when it is not the current one", () => {
    expect(dayLabel("2025-10-12", "2026-10-20")).toBe("12 de octubre de 2025");
  });

  it("falls back to the plain date without a today", () => {
    expect(dayLabel("2026-10-12", null)).toBe("12 de octubre de 2026");
  });
});

describe("buildTimeline", () => {
  const opts = { lastReadAt: null, meId: ME, timeZone: "UTC", today: "2026-10-18" };

  it("puts a day separator before the first message of each day", () => {
    const a = makeMessage({ createdAt: utc(17, 10) });
    const b = makeMessage({ createdAt: utc(17, 11) });
    const c = makeMessage({ createdAt: utc(18, 9) });
    const t = buildTimeline([a, b, c], opts);
    expect(t.map((e) => (e.type === "message" ? e.message.id : e.type === "day" ? e.label : e.type))).toEqual([
      "Ayer",
      a.id,
      b.id,
      "Hoy",
      c.id,
    ]);
  });

  it("groups a run of the same author and breaks the run at a day change", () => {
    const a = makeMessage({ authorId: OTHER, createdAt: utc(17, 23, 58) });
    const b = makeMessage({ authorId: OTHER, createdAt: utc(17, 23, 59) });
    const c = makeMessage({ authorId: OTHER, createdAt: utc(18, 0, 1) });
    const grouped = buildTimeline([a, b, c], opts).flatMap((e) => (e.type === "message" ? [e.grouped] : []));
    expect(grouped).toEqual([false, true, false]);
  });

  it("uses the viewer's time zone for the day boundary", () => {
    // 21:30 and 22:30 UTC on the 17th: the same day in UTC, two days in Madrid (23:30 the 17th, 00:30 the 18th).
    const a = makeMessage({ createdAt: utc(17, 21, 30) });
    const b = makeMessage({ createdAt: utc(17, 22, 30) });
    const days = (tz: string) => buildTimeline([a, b], { ...opts, timeZone: tz }).filter((e) => e.type === "day").length;
    expect(days("UTC")).toBe(1);
    expect(days("Europe/Madrid")).toBe(2);
  });

  it("places the unread separator after the day separator and breaks the group there", () => {
    const a = makeMessage({ authorId: OTHER, createdAt: utc(18, 10, 0) });
    const b = makeMessage({ authorId: OTHER, createdAt: utc(18, 10, 2) });
    const t = buildTimeline([a, b], { ...opts, lastReadAt: utc(18, 10, 1) });
    expect(t.map((e) => e.type)).toEqual(["day", "message", "unread", "message"]);
    expect(t[3]).toMatchObject({ type: "message", grouped: false });
  });

  it("without a time zone (the server pass) has no day separators but still groups", () => {
    const a = makeMessage({ authorId: OTHER, createdAt: utc(17, 10, 0) });
    const b = makeMessage({ authorId: OTHER, createdAt: utc(17, 10, 1) });
    const t = buildTimeline([a, b], { ...opts, timeZone: null, today: null });
    expect(t.map((e) => e.type)).toEqual(["message", "message"]);
    expect(t[1]).toMatchObject({ grouped: true });
  });

  it("never groups after a deleted message, so its marker keeps its own header", () => {
    const a = makeMessage({ authorId: OTHER, createdAt: utc(18, 10, 0), deletedAt: utc(18, 10, 5) });
    const b = makeMessage({ authorId: OTHER, createdAt: utc(18, 10, 1) });
    expect(buildTimeline([a, b], opts)[2]).toMatchObject({ type: "message", grouped: false });
  });
});

describe("isArrival", () => {
  const base = makeMessage({ createdAt: utc(18, 10, 0) });

  it("is true only for messages newer than the newest one at mount", () => {
    expect(isArrival(makeMessage({ createdAt: utc(18, 10, 1) }), base)).toBe(true);
    expect(isArrival(base, base)).toBe(false);
    expect(isArrival(makeMessage({ createdAt: utc(18, 9, 0) }), base)).toBe(false);
  });

  it("treats everything as an arrival when the channel was empty at mount", () => {
    expect(isArrival(makeMessage(), undefined)).toBe(true);
  });
});

describe("scroll", () => {
  it("counts as near the bottom within the slack", () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 560, clientHeight: 400 })).toBe(true);
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 })).toBe(false);
  });

  describe("decideScroll", () => {
    const base = { initial: false, anchorFound: false, forced: false, prepended: false, atBottom: false };

    it("first placement: the anchor when it is in the window, the bottom otherwise", () => {
      expect(decideScroll({ ...base, initial: true, anchorFound: true })).toBe("anchor");
      expect(decideScroll({ ...base, initial: true })).toBe("bottom");
    });

    it("a forced scroll (my own send) always goes to the bottom", () => {
      expect(decideScroll({ ...base, forced: true })).toBe("bottom");
    });

    it("keeps the reading position when older messages are prepended", () => {
      expect(decideScroll({ ...base, prepended: true })).toBe("keep");
    });

    it("follows only when the reader is at the bottom", () => {
      expect(decideScroll({ ...base, atBottom: true })).toBe("bottom");
      expect(decideScroll(base)).toBe("none");
    });
  });

  describe("countUnseen", () => {
    const seen = makeMessage({ createdAt: utc(18, 10, 0) });

    it("counts other members' visible messages newer than the mark", () => {
      const list = [
        seen,
        makeMessage({ authorId: OTHER, createdAt: utc(18, 10, 1) }),
        makeMessage({ authorId: ME, createdAt: utc(18, 10, 2) }),
        makeMessage({ authorId: OTHER, createdAt: utc(18, 10, 3), deletedAt: utc(18, 10, 4) }),
        makeMessage({ authorId: OTHER, createdAt: utc(18, 10, 5) }),
      ];
      expect(countUnseen(list, { createdAt: seen.createdAt, id: seen.id }, ME)).toBe(2);
    });

    it("is zero without a mark", () => {
      expect(countUnseen([seen], null, ME)).toBe(0);
    });
  });

  it("labels the pill in Spanish, singular and plural", () => {
    expect(newMessagesLabel(1)).toBe("1 mensaje nuevo");
    expect(newMessagesLabel(3)).toBe("3 mensajes nuevos");
  });
});
