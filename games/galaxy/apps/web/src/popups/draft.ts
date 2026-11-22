import type { PopupAnswerInput, PopupQuestionView, PopupView } from '@galaxy/shared';

// What a player has answered so far in a popup of «Encuestas y avisos» (plan 2026-11-22, part A), and what is sent.
// Scales, stars and choices must be answered; a text only when its question asks for it (the server's rules,
// `normalizeAnswers` in packages/shared): the popup holds «Siguiente» and «Enviar» until they are.

/** One question's answer while the popup is open. */
export interface Draft {
  score?: number;
  choices?: string[];
  text?: string;
}
export type Drafts = Readonly<Record<string, Draft>>;

/** Whether a question has what it needs to go on: a score, an option, or some text when it must have one. */
export function answered(q: PopupQuestionView, d: Draft | undefined): boolean {
  switch (q.type) {
    case 'scale':
    case 'stars':
      return d?.score !== undefined;
    case 'choice':
      return (d?.choices?.length ?? 0) > 0;
    case 'text':
      return !q.required || (d?.text?.trim().length ?? 0) > 0;
  }
}

/** The answers as the server takes them (`popupAnswersSchema`): in the questions' order, an empty text left out. */
export function answersOf(questions: readonly PopupQuestionView[], drafts: Drafts): PopupAnswerInput[] {
  return questions.flatMap((q): PopupAnswerInput[] => {
    const d = drafts[q.id];
    if (q.type === 'scale' || q.type === 'stars') return d?.score === undefined ? [] : [{ q: q.id, score: d.score }];
    if (q.type === 'choice') {
      const picked = d?.choices ?? [];
      return picked.length > 0 ? [{ q: q.id, choices: q.options.filter((o) => picked.includes(o.id)).map((o) => o.id) }] : [];
    }
    const text = d?.text?.trim() ?? '';
    return text ? [{ q: q.id, text }] : [];
  });
}

/**
 * The screens of a popup, each with its questions: a review's stars and text together (the owner's mock-up), any
 * other question on a screen of its own; a promotion has none.
 */
export function screensOf(popup: Pick<PopupView, 'kind' | 'questions'>): PopupQuestionView[][] {
  if (popup.kind === 'review') return popup.questions.length > 0 ? [[...popup.questions]] : [];
  return popup.questions.map((q) => [q]);
}
