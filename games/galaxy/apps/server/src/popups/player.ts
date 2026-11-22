import {
  type Gift,
  type GrantedItem,
  inAudience,
  levelOf,
  madridDayOf,
  mediaUrl,
  nextPopup,
  type PopupAnswerInput,
  type PopupAnswerResult,
  type PopupCandidate,
  type PopupNext,
  POPUP_ANSWER_GRACE_MS,
  POPUP_MAX_SHOWS,
  type PopupQuestionView,
  type PopupRewardSkip,
  type PopupSubjectView,
  type PopupView,
  type PopupViewState,
  normalizeAnswers,
  type PopupSubject,
} from '@galaxy/shared';
import type { Content } from '@galaxy/sim';
import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';
import { getWallet } from '../economy/wallet';
import { HttpError } from '../errors';
import { grantGifts } from '../gifts/grant';
import { giftBlock } from '../gifts/guard';
import { invalidateLeaderboard } from '../social/leaderboard';
import type { PopupDeps } from './admin';
import { POPUP_FIELDS, popupById, type PopupRow, readPopupRow } from './records';

// «Encuestas y avisos» for players (plan 2026-11-22, part A; GDD §16.5). Which popup to show is only read (loading the
// title screen again never spends a show); the show is counted apart, and that is where the rules really hold: three
// shows at most, never twice the same Madrid day, one popup a day over every campaign (also a unique index), never one
// already done. «Más tarde» is counted, a promotion is closed (maybe through «Ver más»), and an answer is kept once
// with its reward: only for accounts that existed when it was published, never to who published it nor to staff
// (the mail's rule). An answer to a campaign shown before its end still counts for 15 minutes after it.

/** What the choice needs of an account: its level, when it was created and its name. */
interface AccountFacts {
  id: string;
  level: number;
  createdAt: Date;
  username: string;
}

async function accountOf(deps: PopupDeps, accountId: string): Promise<AccountFacts> {
  const [row, cfg] = await Promise.all([
    deps.db
      .selectFrom('galaxy.accounts as a')
      .leftJoin('galaxy.account_xp as x', 'x.account_id', 'a.id')
      .select(['a.id', 'a.username', 'a.created_at', 'x.xp'])
      .where('a.id', '=', accountId)
      .executeTakeFirstOrThrow(),
    deps.config.get('account'),
  ]);
  return { id: row.id, username: row.username, createdAt: new Date(row.created_at), level: levelOf(Number(row.xp ?? 0), cfg).level };
}

/** Published campaigns open now (not ended), whose stored record still holds. */
async function liveCampaigns(db: Kysely<DB>, now: Date): Promise<PopupRow[]> {
  const raw = await db
    .selectFrom('galaxy.popup_campaigns')
    .select(POPUP_FIELDS)
    .where('state', '=', 'published')
    .where('ended_at', 'is', null)
    .where('starts_at', '<=', now)
    .where('ends_at', '>', now)
    .execute();
  const out: PopupRow[] = [];
  for (const r of raw) {
    try {
      out.push(readPopupRow(r));
    } catch {
      // A stored record that no longer holds is never shown (the panel reports it).
    }
  }
  return out;
}

/** Every view of an account (its shows, its last day and whether it is done). */
async function viewsOf(db: Kysely<DB>, accountId: string): Promise<PopupViewState[]> {
  const rows = await db
    .selectFrom('galaxy.popup_views')
    .select(['campaign_id', 'shows', sql<string | null>`to_char(last_shown_day, 'YYYY-MM-DD')`.as('day'), 'done_at'])
    .where('account_id', '=', accountId)
    .execute();
  return rows.map((r) => ({ campaignId: r.campaign_id, shows: r.shows, lastShownDay: r.day, done: r.done_at !== null }));
}

const candidateOf = (p: PopupRow): PopupCandidate => ({
  id: p.id,
  state: p.state,
  startsAt: p.record.startsAt,
  endsAt: p.record.endsAt,
  endedAt: p.endedAt,
  priority: p.record.priority,
  audience: p.record.audience,
});

/** A scale's subject as the popup draws it (a sector with its Core's sprite); null when it left the content. */
function subjectView(s: PopupSubject, content: Content): PopupSubjectView | null {
  const found =
    s.kind === 'enemy'
      ? content.enemies.find((e) => e.id === s.id)
      : s.kind === 'boss'
        ? content.bosses.find((b) => b.id === s.id)
        : s.kind === 'probe'
          ? content.probes.find((p) => p.id === s.id)
          : (() => {
              const sector = content.sectors.find((x) => x.id === s.id);
              const boss = sector ? content.bosses.find((b) => b.id === sector.boss) : undefined;
              return sector && boss ? { name: sector.name, sprite: boss.sprite } : undefined;
            })();
  return found ? { kind: s.kind, id: s.id, name: found.name, sprite: found.sprite } : null;
}

/** Why this account would not take the campaign's reward (null: it would; also null when there is none). */
async function rewardSkip(db: Kysely<DB>, p: PopupRow, account: { id: string; createdAt: Date }): Promise<PopupRewardSkip | null> {
  if (p.record.reward.length === 0) return null;
  const block = await giftBlock(db, account.id, p.publishedBy);
  if (block) return block;
  // Only accounts that existed when it was published (so a reward cannot be farmed with new accounts) [U].
  return p.publishedAt && account.createdAt.getTime() > Date.parse(p.publishedAt) ? 'newcomer' : null;
}

/** A campaign as this player's popup shows it. */
async function viewOf(deps: PopupDeps, p: PopupRow, account: AccountFacts): Promise<PopupView> {
  const content = await deps.config.get('content');
  const questions: PopupQuestionView[] = p.record.questions.map((q) => (q.type === 'scale' ? { ...q, subject: q.subject ? subjectView(q.subject, content) : null } : q));
  const reward: Gift[] = (await rewardSkip(deps.db, p, account)) === null ? p.record.reward : [];
  return {
    id: p.id,
    kind: p.record.kind,
    title: p.record.title,
    body: p.record.body,
    image: p.record.imageMedia ? mediaUrl(p.record.imageMedia) : null,
    link: p.record.link,
    questions,
    reward,
  };
}

/** GET /popups/next: the popup to show now, if any. Only reads. */
export async function popupNext(deps: PopupDeps, accountId: string): Promise<PopupNext> {
  const now = deps.now();
  const [campaigns, views, account] = await Promise.all([liveCampaigns(deps.db, now), viewsOf(deps.db, accountId), accountOf(deps, accountId)]);
  const id = nextPopup(campaigns.map(candidateOf), views, account, now, madridDayOf(now.toISOString()));
  const p = id ? campaigns.find((c) => c.id === id) : undefined;
  return { popup: p ? await viewOf(deps, p, account) : null };
}

/** A published campaign open now that reaches this account (its audience as of now), or 404. */
async function openFor(deps: PopupDeps, id: string, account: AccountFacts, now: Date): Promise<PopupRow> {
  const p = await popupById(deps.db, id);
  if (p.state !== 'published' || Date.parse(p.record.startsAt) > now.getTime() || !inAudience(p.record.audience, account, now)) throw new HttpError(404, 'popup_not_found');
  if (p.endedAt !== null || Date.parse(p.record.endsAt) <= now.getTime()) throw new HttpError(409, 'popup_closed');
  return p;
}

/**
 * POST /popups/:id/shown: counts a show, only while it may be shown (open, in the audience, not done, fewer than three
 * shows, not shown today, no other popup today). The same campaign shown again the same day is a no-op (a reload, a
 * second render); anything else that may not be shown is `popup_closed`.
 */
export async function popupShown(deps: PopupDeps, accountId: string, id: string): Promise<void> {
  const now = deps.now();
  const today = madridDayOf(now.toISOString());
  const account = await accountOf(deps, accountId);
  await openFor(deps, id, account, now);
  const counted = await deps.db
    .insertInto('galaxy.popup_views')
    .values({ campaign_id: id, account_id: accountId, shows: 1, first_shown_at: now, last_shown_at: now, last_shown_day: today })
    .onConflict((oc) =>
      oc.columns(['campaign_id', 'account_id']).doUpdateSet({ shows: sql`galaxy.popup_views.shows + 1`, last_shown_at: now, last_shown_day: today, first_shown_at: sql`coalesce(galaxy.popup_views.first_shown_at, ${now})` }).where((eb) =>
        eb.and([
          eb('galaxy.popup_views.done_at', 'is', null),
          eb('galaxy.popup_views.shows', '<', POPUP_MAX_SHOWS),
          eb.or([eb('galaxy.popup_views.last_shown_day', 'is', null), eb('galaxy.popup_views.last_shown_day', '<>', today)]),
        ]),
      ),
    )
    .returning('shows')
    .executeTakeFirst()
    .catch((err: unknown) => {
      // The unique (account, day): another popup was already shown today.
      if ((err as { code?: string }).code === '23505') return undefined;
      throw err;
    });
  if (counted) return;
  const mine = await deps.db
    .selectFrom('galaxy.popup_views')
    .select([sql<string | null>`to_char(last_shown_day, 'YYYY-MM-DD')`.as('day'), 'done_at'])
    .where('campaign_id', '=', id)
    .where('account_id', '=', accountId)
    .executeTakeFirst();
  if (mine && mine.day === today && mine.done_at === null) return;
  throw new HttpError(409, 'popup_closed');
}

/** The account's view of a campaign it was shown, or 404 (never shown: nothing to answer, close or put off). */
async function shownView(db: Kysely<DB>, id: string, accountId: string, lock = false) {
  let q = db.selectFrom('galaxy.popup_views').select(['shows', 'dismissals', 'done_at', 'last_shown_at']).where('campaign_id', '=', id).where('account_id', '=', accountId);
  if (lock) q = q.forUpdate();
  const v = await q.executeTakeFirst();
  if (!v || v.shows === 0) throw new HttpError(404, 'popup_not_found');
  return v;
}

/** POST /popups/:id/later: «Más tarde», once per show (more taps change nothing). */
export async function popupLater(deps: PopupDeps, accountId: string, id: string): Promise<void> {
  await shownView(deps.db, id, accountId);
  await deps.db
    .updateTable('galaxy.popup_views')
    .set({ dismissals: sql`dismissals + 1` })
    .where('campaign_id', '=', id)
    .where('account_id', '=', accountId)
    .where('done_at', 'is', null)
    .where(sql<boolean>`dismissals < shows`)
    .execute();
}

/** POST /popups/:id/seen: a promotion closed (done), through «Ver más» or not. */
export async function popupSeen(deps: PopupDeps, accountId: string, id: string, clicked: boolean): Promise<void> {
  const p = await popupById(deps.db, id);
  if (p.state !== 'published') throw new HttpError(404, 'popup_not_found');
  if (p.record.kind !== 'promotion') throw new HttpError(409, 'popup_wrong_kind');
  await shownView(deps.db, id, accountId);
  const now = deps.now();
  await deps.db
    .updateTable('galaxy.popup_views')
    .set({ done_at: sql`coalesce(done_at, ${now})`, ...(clicked ? { clicked_at: sql`coalesce(clicked_at, ${now})` } : {}) })
    .where('campaign_id', '=', id)
    .where('account_id', '=', accountId)
    .execute();
}

/**
 * POST /popups/:id/answer, inside the operation of its `Idempotency-Key`: the answers checked against the questions
 * (texts through the live word filter), kept once per account, and the reward paid unless the account may not take it.
 * A campaign shown before its end still takes answers for 15 minutes after it.
 */
export async function popupAnswer(trx: Kysely<DB>, deps: PopupDeps, accountId: string, id: string, raw: readonly PopupAnswerInput[], key: string): Promise<{ result: PopupAnswerResult; seasonTouched: boolean }> {
  const now = deps.now();
  const p = await popupById(trx, id);
  if (p.state !== 'published') throw new HttpError(404, 'popup_not_found');
  if (p.record.kind === 'promotion') throw new HttpError(409, 'popup_wrong_kind');
  const view = await shownView(trx, id, accountId, true);
  const answered = await trx.selectFrom('galaxy.popup_responses').select('account_id').where('campaign_id', '=', id).where('account_id', '=', accountId).executeTakeFirst();
  if (answered || view.done_at !== null) throw new HttpError(409, 'popup_answered');
  const end = Math.min(Date.parse(p.record.endsAt), p.endedAt ? Date.parse(p.endedAt) : Number.POSITIVE_INFINITY);
  const shownBefore = view.last_shown_at !== null && new Date(view.last_shown_at).getTime() < end;
  if (now.getTime() >= end + (shownBefore ? POPUP_ANSWER_GRACE_MS : 0)) throw new HttpError(409, 'popup_closed');

  const chat = await deps.config.get('chat');
  const { answers, issues } = normalizeAnswers(p.record.questions, raw, chat.words);
  if (issues.length > 0) throw new HttpError(400, 'popup_answers_invalid', { issues });

  const account = await trx.selectFrom('galaxy.accounts').select(['id', 'created_at']).where('id', '=', accountId).executeTakeFirstOrThrow();
  const skipped = await rewardSkip(trx, p, { id: account.id, createdAt: new Date(account.created_at) });
  let granted: GrantedItem[] | null = null;
  let seasonTouched = false;
  if (p.record.reward.length > 0 && skipped === null) {
    const season = await deps.config.get('season');
    const given = await grantGifts(trx, accountId, p.record.reward, {
      key: `popup:${id}`,
      // Each player's own galaxies (the same answer always makes the same ones).
      seedKey: `popup:${id}:${accountId}`,
      reason: 'popup_reward',
      ref: { popup: id },
      actor: { id: accountId, label: 'encuestas' },
      // Nothing seasonal is ever a campaign's reward (popupIssues).
      season: { id: season.id, open: false },
      auditAction: 'popup.reward',
    });
    granted = given.items;
    seasonTouched = given.seasonTouched;
  }
  await trx
    .insertInto('galaxy.popup_responses')
    .values({ campaign_id: id, account_id: accountId, op_key: key, answered_at: now, reward: granted ? JSON.stringify(granted) : null, reward_skipped: skipped })
    .execute();
  if (answers.length > 0) {
    await trx
      .insertInto('galaxy.popup_answers')
      .values(
        answers.map((a) => ({
          campaign_id: id,
          account_id: accountId,
          question_id: a.q,
          score: 'score' in a ? a.score : null,
          choices: 'choices' in a ? a.choices : null,
          text: 'text' in a ? a.text : null,
          created_at: now,
        })),
      )
      .execute();
  }
  await trx.updateTable('galaxy.popup_views').set({ done_at: now }).where('campaign_id', '=', id).where('account_id', '=', accountId).execute();
  return { result: { granted, skipped, wallet: await getWallet(trx, accountId) }, seasonTouched };
}

/** After an answer whose reward touched the season (never, today: nothing seasonal is a reward). */
export function afterAnswer(seasonTouched: boolean): void {
  if (seasonTouched) invalidateLeaderboard();
}
