// The probe test (GDD §6, §12.2): five questions with three answers; each answer adds a point to one of the three
// starting probes, which are balanced (different tactics, none better). On a tie, a sixth question decides. The
// texts live in the web copy; here, which probe each answer gives. The order rotates between questions, so the same
// position never always means the same probe. Shared by the client (to know whether to ask the tiebreak) and the
// server (which scores and stores the result).

export const STARTERS = ['lumen', 'bastion', 'spark'] as const;
export type Starter = (typeof STARTERS)[number];

type Answers = readonly [Starter, Starter, Starter];

export const PROBE_TEST: { questions: readonly { answers: Answers }[]; tiebreak: { answers: Answers } } = {
  questions: [
    { answers: ['lumen', 'bastion', 'spark'] },
    { answers: ['spark', 'lumen', 'bastion'] },
    { answers: ['bastion', 'spark', 'lumen'] },
    { answers: ['lumen', 'spark', 'bastion'] },
    { answers: ['bastion', 'lumen', 'spark'] },
  ],
  tiebreak: { answers: ['lumen', 'bastion', 'spark'] },
};

/**
 * The result of the answers (indexes 0–2): the probe, or the probes tied on top when there are only five answers and
 * a tie. With the sixth (tiebreak) answer, a tie goes to the probe it names. Throws RangeError('bad_answers').
 */
export function scoreTest(answers: readonly number[]): { probe: Starter } | { tie: Starter[] } {
  const n = PROBE_TEST.questions.length;
  if (answers.length < n || answers.length > n + 1 || !answers.every((a) => Number.isInteger(a) && a >= 0 && a <= 2)) {
    throw new RangeError('bad_answers');
  }
  const score: Record<Starter, number> = { lumen: 0, bastion: 0, spark: 0 };
  PROBE_TEST.questions.forEach((q, i) => {
    score[q.answers[answers[i]!]!]++;
  });
  const top = Math.max(...STARTERS.map((s) => score[s]));
  const leaders = STARTERS.filter((s) => score[s] === top);
  if (leaders.length === 1) return { probe: leaders[0]! };
  const breaker = answers[n];
  if (breaker === undefined) return { tie: [...leaders] };
  return { probe: PROBE_TEST.tiebreak.answers[breaker]! };
}
