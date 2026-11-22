import { type AdminPopupResults, POPUP_MAX_SHOWS, POPUP_TEXTS_PAGE, type PopupAnswerCounts, type PopupQuestion, type PopupTextsPage, type PopupTotals, summarizeQuestion } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { csvFile } from '../admin/csv';
import type { DB } from '../db/schema';
import { HttpError } from '../errors';
import { adminPopupOf, type PopupDeps } from './admin';
import { popupById, type PopupRow } from './records';

// The results of «Encuestas y avisos» (plan 2026-11-22, part A; GDD §16.5): what players did (saw it, answered, «Más
// tarde», will not see it again, rewards paid; for a promotion, closed and «Ver más») and each question summed up in
// SQL. The texts are read 50 at a time with who wrote each (only admins see them), and everything exports to a CSV
// that spreadsheets open safely.

/** At most this many responses in a CSV. */
export const POPUP_CSV_MAX = 20_000;

async function totalsOf(db: Kysely<DB>, id: string): Promise<PopupTotals> {
  const [views, responses] = await Promise.all([
    db
      .selectFrom('galaxy.popup_views')
      .select([
        sql<number>`(count(*) filter (where shows > 0))::int`.as('seen'),
        sql<number>`coalesce(sum(dismissals), 0)::int`.as('later'),
        sql<number>`(count(*) filter (where shows >= ${POPUP_MAX_SHOWS} and done_at is null))::int`.as('exhausted'),
        sql<number>`(count(*) filter (where done_at is not null))::int`.as('closed'),
        sql<number>`(count(*) filter (where clicked_at is not null))::int`.as('clicked'),
      ])
      .where('campaign_id', '=', id)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('galaxy.popup_responses')
      .select([sql<number>`count(*)::int`.as('answered'), sql<number>`(count(*) filter (where reward is not null))::int`.as('rewarded')])
      .where('campaign_id', '=', id)
      .executeTakeFirstOrThrow(),
  ]);
  return { ...views, ...responses };
}

/** Each question's counts: its scores, its options (once per pick) and how many answered it. */
async function countsOf(db: Kysely<DB>, id: string): Promise<Map<string, PopupAnswerCounts>> {
  const [scores, picks, answered] = await Promise.all([
    db
      .selectFrom('galaxy.popup_answers')
      .select(['question_id', 'score', sql<number>`count(*)::int`.as('n')])
      .where('campaign_id', '=', id)
      .where('score', 'is not', null)
      .groupBy(['question_id', 'score'])
      .execute(),
    db
      .selectFrom(sql<{ question_id: string; option: string }>`(select question_id, unnest(choices) as option from galaxy.popup_answers where campaign_id = ${id} and choices is not null)`.as('p'))
      .select(['p.question_id', 'p.option', sql<number>`count(*)::int`.as('n')])
      .groupBy(['p.question_id', 'p.option'])
      .execute(),
    db.selectFrom('galaxy.popup_answers').select(['question_id', sql<number>`count(*)::int`.as('n')]).where('campaign_id', '=', id).groupBy('question_id').execute(),
  ]);
  const out = new Map<string, { respondents: number; values: Record<string, number> }>();
  const of = (q: string) => out.get(q) ?? out.set(q, { respondents: 0, values: {} }).get(q)!;
  for (const r of answered) of(r.question_id).respondents = r.n;
  for (const r of scores) of(r.question_id).values[String(r.score)] = r.n;
  for (const r of picks) of(r.question_id).values[r.option] = r.n;
  return out;
}

/** GET /admin/popups/:id/results: the totals and each question's summary, in the questions' order. */
export async function popupResults(deps: PopupDeps, id: string): Promise<AdminPopupResults> {
  const p = await popupById(deps.db, id);
  const [popup, totals, counts] = await Promise.all([adminPopupOf(deps, p), totalsOf(deps.db, id), countsOf(deps.db, id)]);
  return { popup, totals, questions: p.record.questions.map((q) => summarizeQuestion(q, counts.get(q.id) ?? { respondents: 0, values: {} })) };
}

/** GET /admin/popups/:id/texts: a text question's answers, newest first, 50 at a time, with who wrote each. */
export async function popupTexts(deps: PopupDeps, id: string, question: string, cursor: string | undefined): Promise<PopupTextsPage> {
  const p = await popupById(deps.db, id);
  if (!p.record.questions.some((q) => q.id === question && q.type === 'text')) throw new HttpError(404, 'popup_not_found');
  if (cursor !== undefined && !/^[1-9]\d{0,18}$/.test(cursor)) throw new HttpError(400, 'invalid_input');
  let page = deps.db
    .selectFrom('galaxy.popup_answers as x')
    .innerJoin('galaxy.accounts as a', 'a.id', 'x.account_id')
    .select(['x.id', 'x.text', 'x.created_at', 'a.username'])
    .where('x.campaign_id', '=', id)
    .where('x.question_id', '=', question)
    .where('x.text', 'is not', null);
  if (cursor !== undefined) page = page.where('x.id', '<', cursor);
  const [rows, total] = await Promise.all([
    page.orderBy('x.id', 'desc').limit(POPUP_TEXTS_PAGE + 1).execute(),
    deps.db
      .selectFrom('galaxy.popup_answers')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('campaign_id', '=', id)
      .where('question_id', '=', question)
      .where('text', 'is not', null)
      .executeTakeFirstOrThrow(),
  ]);
  const shown = rows.slice(0, POPUP_TEXTS_PAGE);
  return {
    question,
    texts: shown.map((r) => ({ username: r.username, text: r.text!, at: new Date(r.created_at).toISOString() })),
    total: total.n,
    next: rows.length > POPUP_TEXTS_PAGE ? String(shown[shown.length - 1]!.id) : null,
  };
}

/** What a stored answer holds, as the CSV writes it (a choice's options by their labels). */
function answerCell(q: PopupQuestion, a: { s: number | null; c: string[] | null; t: string | null } | undefined): unknown {
  if (!a) return '';
  if (q.type === 'choice') return (a.c ?? []).map((id) => q.options.find((o) => o.id === id)?.label ?? id).join('; ');
  return q.type === 'text' ? a.t : a.s;
}

const REWARD_CELL: Record<string, string> = { paid: 'pagado', self: 'no, la publicó', staff: 'no, equipo', newcomer: 'no, cuenta nueva' };

/** GET /admin/popups/:id/results.csv: one row per response (the first 20 000), with each answer and the reward. */
export async function popupCsv(deps: PopupDeps, id: string): Promise<{ row: PopupRow; csv: string }> {
  const row = await popupById(deps.db, id);
  const rows = await deps.db
    .selectFrom('galaxy.popup_responses as r')
    .innerJoin('galaxy.accounts as a', 'a.id', 'r.account_id')
    .select([
      'a.username',
      'r.answered_at',
      'r.reward_skipped',
      sql<boolean>`r.reward is not null`.as('paid'),
      sql<Record<string, { s: number | null; c: string[] | null; t: string | null }> | null>`(select jsonb_object_agg(x.question_id, jsonb_build_object('s', x.score, 'c', x.choices, 't', x.text)) from galaxy.popup_answers x where x.campaign_id = r.campaign_id and x.account_id = r.account_id)`.as(
        'answers',
      ),
    ])
    .where('r.campaign_id', '=', id)
    .orderBy('r.answered_at')
    .orderBy('r.account_id')
    .limit(POPUP_CSV_MAX)
    .execute();
  const questions = row.record.questions;
  const withReward = row.record.reward.length > 0;
  const header = ['fecha', 'usuario', ...questions.map((q) => q.prompt), ...(withReward ? ['premio'] : [])];
  const lines = rows.map((r) => [
    new Date(r.answered_at).toISOString(),
    r.username,
    ...questions.map((q) => answerCell(q, r.answers?.[q.id])),
    ...(withReward ? [REWARD_CELL[r.paid ? 'paid' : (r.reward_skipped ?? '')] ?? ''] : []),
  ]);
  return { row, csv: csvFile([header, ...lines]) };
}
