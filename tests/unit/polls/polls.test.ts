import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  POLL_LIMITS,
  POLL_WHITESPACE_CLASS,
  formatTenths,
  normalizePollText,
  parsePollRow,
  pollTimeLeft,
  validatePollDraft,
  voterCountLabel,
} from "@/lib/polls/polls";

describe("formatTenths", () => {
  it.each([
    [333, "33,3 %"],
    [1000, "100 %"],
    [0, "0 %"],
    [5, "0,5 %"],
    [580, "58 %"], // weighted results arrive as multiples of 10 (F4e-R3): no decimal
    [667, "66,7 %"],
  ])("%i -> %s", (t, s) => expect(formatTenths(t)).toBe(s));
});

describe("voterCountLabel", () => {
  it("pluralizes", () => {
    expect(voterCountLabel(1)).toBe("1 votante");
    expect(voterCountLabel(0)).toBe("0 votantes");
    expect(voterCountLabel(12)).toBe("12 votantes");
  });
});

describe("pollTimeLeft", () => {
  const now = Date.parse("2026-10-19T10:00:00Z");
  const at = (ms: number) => new Date(now + ms).toISOString();
  const H = 3_600_000;
  const M = 60_000;
  it.each([
    [3 * 24 * H + 4 * H + 5 * M, "Cierra en 3 d 4 h"],
    [5 * H + 10 * M, "Cierra en 5 h 10 min"],
    [2 * H, "Cierra en 2 h"],
    [59 * M, "Cierra en 59 min"],
    [12 * M, "Cierra en 12 min"],
    [30_000, "Cierra en menos de 1 min"],
    [0, "Cerrada"],
    [-5000, "Cerrada"],
  ])("%i ms -> %s", (ms, s) => expect(pollTimeLeft(at(ms), now)).toBe(s));
  it("treats an unparsable date as closed", () => expect(pollTimeLeft("nope", now)).toBe("Cerrada"));
});

describe("normalizePollText (F4e-R1)", () => {
  it("collapses whitespace runs, newlines included, and trims", () => {
    expect(normalizePollText("  a \n\t b  ")).toBe("a b");
  });
  it("treats NBSP and the Unicode spaces as whitespace, like SQL", () => {
    expect(normalizePollText(" 　")).toBe("");
    expect(normalizePollText("a  b﻿")).toBe("a b");
  });
  it("pins the whitespace class against every code point and against the SQL source", () => {
    const expected = new Set<number>([
      9, 10, 11, 12, 13, 32, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
      ...Array.from({ length: 0x200a - 0x2000 + 1 }, (_, i) => 0x2000 + i),
    ]);
    const re = new RegExp(`^${POLL_WHITESPACE_CLASS}$`);
    for (let cp = 0; cp <= 0xffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      expect(re.test(String.fromCharCode(cp)), `U+${cp.toString(16)}`).toBe(expected.has(cp));
    }
    const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261019500003_poll_votes.sql"), "utf8");
    expect(sql).toContain(`'[\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+'`);
    expect(POLL_WHITESPACE_CLASS).toBe("[\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]");
  });
});

describe("validatePollDraft", () => {
  const now = new Date("2026-10-19T10:00:00Z");
  const base = { question: "¿Comemos?", options: ["Sí", "No"], closesAt: new Date(now.getTime() + 2 * 3_600_000), now };
  it("accepts a valid draft", () => expect(validatePollDraft(base)).toEqual({ ok: true }));
  it("accepts the boundaries", () => {
    expect(validatePollDraft({ ...base, closesAt: new Date(now.getTime() + POLL_LIMITS.minMs) })).toEqual({ ok: true });
    expect(validatePollDraft({ ...base, closesAt: new Date(now.getTime() + POLL_LIMITS.maxMs) })).toEqual({ ok: true });
    expect(validatePollDraft({ ...base, question: "a".repeat(300), options: ["a".repeat(80), "b"] })).toEqual({ ok: true });
  });
  it.each([
    ["empty question", { question: "" }, "question_required", "question"],
    ["whitespace-only question", { question: " \n  " }, "question_required", "question"],
    ["301-char question", { question: "a".repeat(301) }, "question_required", "question"],
    ["one option", { options: ["Sí"] }, "poll_options_invalid", "options"],
    ["eleven options", { options: Array.from({ length: 11 }, (_, i) => `o${i}`) }, "poll_options_invalid", "options"],
    ["empty option", { options: ["Sí", "  "] }, "poll_options_invalid", "options"],
    ["81-char option", { options: ["Sí", "a".repeat(81)] }, "poll_options_invalid", "options"],
    ["duplicate, case-insensitive", { options: ["Sí", "sí"] }, "poll_options_invalid", "options"],
    ["duplicate after collapsing", { options: ["a  b", "A B"] }, "poll_options_invalid", "options"],
    ["NBSP-variant duplicate", { options: ["a b", "a b"] }, "poll_options_invalid", "options"],
    ["closes in 59 min", { closesAt: new Date(now.getTime() + 59 * 60_000) }, "closes_at_invalid", "closesAt"],
    ["closes past 30 d", { closesAt: new Date(now.getTime() + POLL_LIMITS.maxMs + 1) }, "closes_at_invalid", "closesAt"],
    ["invalid date", { closesAt: new Date("nope") }, "closes_at_invalid", "closesAt"],
  ])("rejects %s", (_n, over, code, field) => {
    expect(validatePollDraft({ ...base, ...over } as never)).toEqual({ ok: false, code, field });
  });
  it("counts code points, not UTF-16 units", () => {
    expect(validatePollDraft({ ...base, question: "😀".repeat(300) })).toEqual({ ok: true });
  });
});

describe("parsePollRow", () => {
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const M = "11111111-1111-4111-8111-111111111111";
  const row = (over: Record<string, unknown> = {}) => ({
    message_id: M,
    weight_mode: "equal",
    closes_at: "2026-10-20T10:00:00+00:00",
    closed: false,
    voter_count: 2,
    options: [
      { id: B, label: "No", position: 2 },
      { id: A, label: "Sí", position: 1 },
    ],
    my_option_id: A,
    i_voted: true,
    my_has_weight: null,
    results_status: "pending",
    results: null,
    ...over,
  });
  it("parses an open poll and sorts options by position", () => {
    expect(parsePollRow(row())).toEqual({
      messageId: M,
      weightMode: "equal",
      closesAt: "2026-10-20T10:00:00+00:00",
      closed: false,
      voterCount: 2,
      options: [
        { id: A, label: "Sí", position: 1 },
        { id: B, label: "No", position: 2 },
      ],
      myOptionId: A,
      iVoted: true,
      myHasWeight: null,
      results: { status: "pending" },
    });
  });
  it("turns published results into tenths by option id", () => {
    const p = parsePollRow(
      row({ closed: true, results_status: "published", results: [{ optionId: A, tenths: 667 }, { optionId: B, tenths: 333 }], my_option_id: null }),
    );
    expect(p?.results).toEqual({ status: "published", tenths: { [A]: 667, [B]: 333 } });
    expect(p?.myOptionId).toBeNull();
  });
  it("parses insufficient", () => {
    expect(parsePollRow(row({ closed: true, results_status: "insufficient" }))?.results).toEqual({ status: "insufficient" });
  });
  it("keeps myHasWeight boolean for weighted polls", () => {
    expect(parsePollRow(row({ weight_mode: "linear", my_has_weight: false }))?.myHasWeight).toBe(false);
  });
  it.each([
    ["unknown mode", { weight_mode: "cubic" }],
    ["missing options", { options: null }],
    ["malformed option", { options: [{ id: A }] }],
    ["unknown status", { results_status: "weird" }],
    ["published without results", { results_status: "published", results: null }],
    ["bad tenths", { results_status: "published", results: [{ optionId: A, tenths: 5000 }] }],
    ["bad message id", { message_id: 5 }],
    ["bad count", { voter_count: "2" }],
  ])("returns null for %s", (_n, over) => expect(parsePollRow(row(over))).toBeNull());
  it("returns null for a non-object", () => {
    expect(parsePollRow(null)).toBeNull();
    expect(parsePollRow("x")).toBeNull();
  });
});
