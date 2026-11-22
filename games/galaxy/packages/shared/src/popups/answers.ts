import { z } from 'zod';
import { cleanBody, maskWords } from '../chat/rules';
import { POPUP_MAX_QUESTIONS, popupItemIdSchema, type PopupQuestion } from './record';

// «Encuestas y avisos» (GDD §16.5; plan 2026-11-22, part A): what a player's answers keep. Each matches its question (a
// score in range, options among its own, one when it is single); scales, stars and choices are always answered, a text
// only when its question asks for it. Texts are only read by admins, and still kept clean: composed, without invisible
// characters, and through the chat's live word filter.

/** One answer as the player sends it: a score (scale, stars), some options (choice) or a text. */
export const popupAnswerInputSchema = z
  .object({
    q: popupItemIdSchema,
    score: z.number().int().optional(),
    choices: z.array(popupItemIdSchema).max(8).optional(),
    /** Raw, before it is cleaned (spaces and line breaks are joined, so it may be longer than the question allows). */
    text: z.string().max(4000).optional(),
  })
  .strict();
export type PopupAnswerInput = z.output<typeof popupAnswerInputSchema>;

/** A campaign's answers as the player sends them (one per question at most). */
export const popupAnswersSchema = z.array(popupAnswerInputSchema).max(POPUP_MAX_QUESTIONS);

/** One answer as it is kept (one `popup_answers` row): exactly one of score, choices or text. */
export type PopupAnswer = { q: string; score: number } | { q: string; choices: string[] } | { q: string; text: string };

/**
 * Why answers are refused (the details of `popup_answers_invalid`): a question that does not exist or answered twice, an
 * answer of another shape, a score out of range, an option not among its own (or repeated), several on a single choice,
 * a question that must be answered and was not, or a text over its length.
 */
export type PopupAnswerIssueCode = 'answer_unknown' | 'answer_duplicate' | 'answer_shape' | 'answer_range' | 'answer_option' | 'answer_single' | 'answer_missing' | 'answer_too_long';
export interface PopupAnswerIssue {
  q: string;
  code: PopupAnswerIssueCode;
}

/** The scores a question takes: a scale its range, stars 1 to 5. */
export function popupScoreRange(q: Extract<PopupQuestion, { type: 'scale' | 'stars' }>): { min: number; max: number } {
  return q.type === 'scale' && q.range === '0-10' ? { min: 0, max: 10 } : { min: 1, max: 5 };
}

/** The fields an answer of each type carries (any other is a wrong shape). */
const FIELD: Record<PopupQuestion['type'], 'score' | 'choices' | 'text'> = { scale: 'score', stars: 'score', choice: 'choices', text: 'text' };

/** One answer checked against its question: what is kept (null: an optional text left empty), or why it is refused. */
function checkOne(q: PopupQuestion, a: PopupAnswerInput, words: readonly string[]): PopupAnswer | null | PopupAnswerIssueCode {
  const field = FIELD[q.type];
  const given = (['score', 'choices', 'text'] as const).filter((f) => a[f] !== undefined);
  if (given.length !== 1 || given[0] !== field) return 'answer_shape';
  switch (q.type) {
    case 'scale':
    case 'stars': {
      const { min, max } = popupScoreRange(q);
      return a.score! < min || a.score! > max ? 'answer_range' : { q: q.id, score: a.score! };
    }
    case 'choice': {
      const picked = a.choices!;
      if (picked.length === 0) return 'answer_missing';
      if (new Set(picked).size !== picked.length || picked.some((c) => !q.options.some((o) => o.id === c))) return 'answer_option';
      if (!q.multi && picked.length > 1) return 'answer_single';
      // Kept in the question's order, whatever order they came in.
      return { q: q.id, choices: q.options.filter((o) => picked.includes(o.id)).map((o) => o.id) };
    }
    case 'text': {
      const clean = cleanBody(a.text!, q.maxLength);
      if (clean !== null) return { q: q.id, text: maskWords(clean, words) };
      // Nothing left once cleaned, or too long.
      if (cleanBody(a.text!, Number.MAX_SAFE_INTEGER) !== null) return 'answer_too_long';
      return q.required ? 'answer_missing' : null;
    }
  }
}

/**
 * A player's answers as they are kept, in the questions' order (`words`: the live chat filter, `chat.words`), and every
 * reason to refuse them: first each answer's in the order sent, then each question that must be answered and was not.
 * Nothing is kept unless `issues` is empty.
 */
export function normalizeAnswers(questions: readonly PopupQuestion[], raw: readonly PopupAnswerInput[], words: readonly string[]): { answers: PopupAnswer[]; issues: PopupAnswerIssue[] } {
  const issues: PopupAnswerIssue[] = [];
  const kept = new Map<string, PopupAnswer>();
  const seen = new Set<string>();
  for (const a of raw) {
    const q = questions.find((x) => x.id === a.q);
    if (!q) {
      issues.push({ q: a.q, code: 'answer_unknown' });
      continue;
    }
    if (seen.has(a.q)) {
      issues.push({ q: a.q, code: 'answer_duplicate' });
      continue;
    }
    seen.add(a.q);
    const result = checkOne(q, a, words);
    if (typeof result === 'string') issues.push({ q: a.q, code: result });
    else if (result) kept.set(q.id, result);
  }
  for (const q of questions) if (!seen.has(q.id) && (q.type !== 'text' || q.required)) issues.push({ q: q.id, code: 'answer_missing' });
  const answers = questions.flatMap((q) => kept.get(q.id) ?? []);
  return { answers, issues };
}
