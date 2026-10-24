// Poll model and pure helpers (no React, no Supabase): usable on server and client. The limits and the normalization
// mirror create_poll in SQL, which stays the judge.

export type PollWeightMode = "equal" | "linear" | "quadratic";

export const POLL_LIMITS = {
  questionMax: 300,
  optionsMin: 2,
  optionsMax: 10,
  optionMax: 80,
  minMs: 3_600_000,
  maxMs: 30 * 86_400_000,
} as const;

/**
 * Ruling F4e-R1: the one whitespace set used on both sides. It is the exact class in supabase/migrations/
 * 20261019500003_poll_votes.sql (`\s` plus U+00A0, U+1680, U+2000-200A, U+2028/9, U+202F, U+205F, U+3000, U+FEFF),
 * which is every code point the JS `\s` matches; a unit test pins it.
 */
export const POLL_WHITESPACE_CLASS = "[\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]";
const WS_RUN = new RegExp(`${POLL_WHITESPACE_CLASS}+`, "g");
const WS_EDGES = new RegExp(`^${POLL_WHITESPACE_CLASS}+|${POLL_WHITESPACE_CLASS}+$`, "g");

export interface PollOption {
  id: string;
  label: string;
  position: number;
}

export type PollResults =
  | { status: "pending" }
  | { status: "insufficient" }
  | { status: "published"; tenths: Record<string, number> };

export interface PollDetail {
  messageId: string;
  weightMode: PollWeightMode;
  closesAt: string;
  closed: boolean;
  voterCount: number;
  options: PollOption[];
  /** The caller's own option, only while the poll is open. */
  myOptionId: string | null;
  iVoted: boolean;
  /** Weighted polls, open: whether the caller has weight in the creation snapshot; null otherwise. */
  myHasWeight: boolean | null;
  /** In weighted polls the tenths are multiples of 10 (whole %, F4e-R3); the total is never assumed to be 100 %. */
  results: PollResults;
}

/** Collapses whitespace runs (newlines included) to one space and trims, like create_poll. */
export function normalizePollText(s: string): string {
  return s.replace(WS_RUN, " ").replace(WS_EDGES, "");
}

const len = (s: string) => [...s].length;

export type PollDraftCheck =
  | { ok: true }
  | { ok: false; code: "question_required" | "poll_options_invalid" | "closes_at_invalid"; field: "question" | "options" | "closesAt" };

/** Same rules, same order as create_poll (the server judges channel and permissions). */
export function validatePollDraft(d: { question: string; options: string[]; closesAt: Date; now: Date }): PollDraftCheck {
  const q = normalizePollText(typeof d.question === "string" ? d.question : "");
  if (len(q) < 1 || len(q) > POLL_LIMITS.questionMax) return { ok: false, code: "question_required", field: "question" };
  const bad = { ok: false, code: "poll_options_invalid", field: "options" } as const;
  if (!Array.isArray(d.options) || d.options.length < POLL_LIMITS.optionsMin || d.options.length > POLL_LIMITS.optionsMax) return bad;
  const seen = new Set<string>();
  for (const o of d.options) {
    if (typeof o !== "string") return bad;
    const label = normalizePollText(o);
    if (len(label) < 1 || len(label) > POLL_LIMITS.optionMax) return bad;
    const key = label.toLowerCase();
    if (seen.has(key)) return bad;
    seen.add(key);
  }
  const diff = d.closesAt.getTime() - d.now.getTime();
  if (!Number.isFinite(diff) || diff < POLL_LIMITS.minMs || diff > POLL_LIMITS.maxMs) {
    return { ok: false, code: "closes_at_invalid", field: "closesAt" };
  }
  return { ok: true };
}

/**
 * Tenths of a percent as text: 333 -> "33,3 %", 1000 -> "100 %". A whole number carries no decimal ("58 %", "66,7 %").
 * Percentages are rounded, so never sum them expecting exactly 100 %.
 */
export function formatTenths(t: number): string {
  const whole = Math.floor(t / 10);
  const dec = t % 10;
  return dec === 0 ? `${whole} %` : `${whole},${dec} %`;
}

export function voterCountLabel(n: number): string {
  return n === 1 ? "1 votante" : `${n} votantes`;
}

export function pollTimeLeft(closesAt: string, nowMs: number): string {
  const ms = Date.parse(closesAt) - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return "Cerrada";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "Cierra en menos de 1 min";
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rest = mins % 60;
  if (days >= 1) return hours > 0 ? `Cierra en ${days} d ${hours} h` : `Cierra en ${days} d`;
  if (hours >= 1) return rest > 0 ? `Cierra en ${hours} h ${rest} min` : `Cierra en ${hours} h`;
  return `Cierra en ${rest} min`;
}

const MODES: ReadonlySet<string> = new Set<PollWeightMode>(["equal", "linear", "quadratic"]);
const isMode = (v: unknown): v is PollWeightMode => typeof v === "string" && MODES.has(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isStr = (v: unknown): v is string => typeof v === "string" && v !== "";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One row of poll_details; null when malformed (the card then falls back to the plain message). */
export function parsePollRow(row: unknown): PollDetail | null {
  if (!isObj(row)) return null;
  const r = row;
  if (!isStr(r.message_id) || !isMode(r.weight_mode) || !isStr(r.closes_at) || typeof r.closed !== "boolean") return null;
  if (!isCount(r.voter_count) || typeof r.i_voted !== "boolean" || !Array.isArray(r.options)) return null;
  const options: PollOption[] = [];
  for (const o of r.options) {
    if (!isObj(o) || !isStr(o.id) || typeof o.label !== "string" || !isCount(o.position)) return null;
    options.push({ id: o.id, label: o.label, position: o.position });
  }
  options.sort((a, b) => a.position - b.position);

  let results: PollResults;
  if (r.results_status === "pending") results = { status: "pending" };
  else if (r.results_status === "insufficient") results = { status: "insufficient" };
  else if (r.results_status === "published") {
    if (!Array.isArray(r.results)) return null;
    const tenths: Record<string, number> = {};
    for (const x of r.results) {
      if (!isObj(x) || !isStr(x.optionId) || !isCount(x.tenths) || x.tenths > 1000) return null;
      tenths[x.optionId] = x.tenths;
    }
    results = { status: "published", tenths };
  } else return null;

  return {
    messageId: r.message_id,
    weightMode: r.weight_mode,
    closesAt: r.closes_at,
    closed: r.closed,
    voterCount: r.voter_count,
    options,
    myOptionId: isStr(r.my_option_id) ? r.my_option_id : null,
    iVoted: r.i_voted,
    myHasWeight: typeof r.my_has_weight === "boolean" ? r.my_has_weight : null,
    results,
  };
}
