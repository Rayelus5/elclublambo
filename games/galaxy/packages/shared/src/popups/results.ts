import { type PopupQuestion, type PopupScaleRange } from './record';
import { popupScoreRange } from './answers';

// «Encuestas y avisos» (GDD §16.5; plan 2026-11-22, part A): what the panel shows of each question once players answer.
// Every value with its count (zeros too) and the average; a 0–10 scale's NPS (the share of promoters, 9 and 10, minus
// the share of detractors, 0 to 6, in points from -100 to 100) with its three counts; a 1–5 scale's and the stars'
// share of 4 and 5 (top-2 box); a choice's count and share of respondents for each option, most picked first. Shares
// are percentages, unrounded (the panel formats them).

/** How many picked each value of a question: a score (as its number) or an option id. */
export interface PopupAnswerCounts {
  /**
   * How many answered it: needed for a multiple choice (one player picks several options) and a text; for the rest,
   * the sum of `values` when absent.
   */
  respondents?: number;
  values: Readonly<Record<string, number>>;
}

export interface PopupBucket {
  value: number;
  count: number;
  /** Of those who answered (0 to 100). */
  pct: number;
}

export interface PopupNps {
  /** % promoters minus % detractors (-100 to 100). */
  score: number;
  promoters: number;
  passives: number;
  detractors: number;
}

export type PopupQuestionSummary =
  | {
      type: 'scale';
      id: string;
      range: PopupScaleRange;
      n: number;
      buckets: PopupBucket[];
      average: number | null;
      /** 0–10 only, null without answers. */
      nps: PopupNps | null;
      /** 1–5 only: the share of 4 and 5, null without answers. */
      topBox: number | null;
    }
  | { type: 'stars'; id: string; n: number; buckets: PopupBucket[]; average: number | null; topBox: number | null }
  | { type: 'choice'; id: string; multi: boolean; n: number; options: { id: string; label: string; count: number; pct: number }[] }
  /** A text's answers are read apart, 50 at a time. */
  | { type: 'text'; id: string; n: number };

const share = (count: number, n: number) => (n > 0 ? (count * 100) / n : 0);

/** Every score of a scale or the stars with its count, the total and the average (what does not fit is left out). */
function buckets(q: Extract<PopupQuestion, { type: 'scale' | 'stars' }>, values: PopupAnswerCounts['values']) {
  const { min, max } = popupScoreRange(q);
  const counts = Array.from({ length: max - min + 1 }, (_, i) => values[String(min + i)] ?? 0);
  const n = counts.reduce((s, c) => s + c, 0);
  const sum = counts.reduce((s, c, i) => s + c * (min + i), 0);
  return { n, average: n > 0 ? sum / n : null, buckets: counts.map((count, i) => ({ value: min + i, count, pct: share(count, n) })) };
}

/** The top-2 box: the share of 4 and 5. */
function topBox(b: PopupBucket[], n: number): number | null {
  return n > 0 ? share(b.filter((x) => x.value >= 4).reduce((s, x) => s + x.count, 0), n) : null;
}

/** A question's results from its answers' counts. */
export function summarizeQuestion(q: PopupQuestion, counts: PopupAnswerCounts): PopupQuestionSummary {
  switch (q.type) {
    case 'scale': {
      const { n, average, buckets: b } = buckets(q, counts.values);
      if (q.range === '1-5') return { type: 'scale', id: q.id, range: q.range, n, buckets: b, average, nps: null, topBox: topBox(b, n) };
      const sum = (from: number, to: number) => b.filter((x) => x.value >= from && x.value <= to).reduce((s, x) => s + x.count, 0);
      const promoters = sum(9, 10);
      const passives = sum(7, 8);
      const detractors = sum(0, 6);
      const nps = n > 0 ? { score: ((promoters - detractors) * 100) / n, promoters, passives, detractors } : null;
      return { type: 'scale', id: q.id, range: q.range, n, buckets: b, average, nps, topBox: null };
    }
    case 'stars': {
      const { n, average, buckets: b } = buckets(q, counts.values);
      return { type: 'stars', id: q.id, n, buckets: b, average, topBox: topBox(b, n) };
    }
    case 'choice': {
      const picked = q.options.map((o) => ({ id: o.id, label: o.label, count: counts.values[o.id] ?? 0 }));
      const n = counts.respondents ?? picked.reduce((s, o) => s + o.count, 0);
      // Most picked first; a tie keeps the question's order (the sort is stable).
      const options = picked.map((o) => ({ ...o, pct: share(o.count, n) })).sort((a, b) => b.count - a.count);
      return { type: 'choice', id: q.id, multi: q.multi, n, options };
    }
    case 'text':
      return { type: 'text', id: q.id, n: counts.respondents ?? 0 };
  }
}
