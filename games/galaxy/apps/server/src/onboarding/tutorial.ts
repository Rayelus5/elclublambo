import { TUTORIAL_CHAPTERS, type TutorialChapter, tutorialUpdateSchema, type TutorialView } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { requireSession } from '../auth/guards';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { credit } from '../economy/wallet';
import { hitRateLimit } from '../ratelimit';

// The guided tutorial on the server (GDD §12.2; polish phase 3). The first read creates the row: active for an account
// that never finished a run, done for one that did (the migration marked the existing players). Advancing only moves
// forward, so two tabs never fight; reaching the station's chapter pays, once, the components to repair the antenna,
// which a new player cannot have yet (PERKINS hands them over and explains where resources come from).

type Row = { chapter: string; skipped_at: Date | null; done_at: Date | null; gift_at: Date | null };
const order = (c: string) => TUTORIAL_CHAPTERS.indexOf(c as TutorialChapter);

function viewOf(r: Row, gift: number): TutorialView {
  const status = r.done_at ? 'done' : r.skipped_at ? 'skipped' : 'active';
  return { status, chapter: r.chapter as TutorialChapter, gift: r.gift_at ? gift : 0 };
}

async function rowOf(db: Kysely<DB>, accountId: string): Promise<Row> {
  const found = await db.selectFrom('galaxy.tutorial').select(['chapter', 'skipped_at', 'done_at', 'gift_at']).where('account_id', '=', accountId).executeTakeFirst();
  if (found) return found;
  const played = await db.selectFrom('galaxy.runs').select('id').where('account_id', '=', accountId).where('finished_at', 'is not', null).limit(1).executeTakeFirst();
  await db
    .insertInto('galaxy.tutorial')
    .values({ account_id: accountId, chapter: played ? 'done' : 'hub', done_at: played ? new Date() : null })
    .onConflict((oc) => oc.doNothing())
    .execute();
  return (await db.selectFrom('galaxy.tutorial').select(['chapter', 'skipped_at', 'done_at', 'gift_at']).where('account_id', '=', accountId).executeTakeFirstOrThrow());
}

export function registerTutorialRoutes(api: FastifyInstance, deps: { db: Kysely<DB>; config: ConfigReader }): void {
  /** The components the antenna's repair costs (live config), the tutorial's one gift. */
  const giftOf = async () => (await deps.config.get('station')).antenna.levels[0]?.cost.components ?? 0;

  api.get('/galaxy/api/tutorial', async (req): Promise<TutorialView> => {
    const s = requireSession(req);
    return viewOf(await rowOf(deps.db, s.accountId), await giftOf());
  });

  api.put('/galaxy/api/tutorial', async (req): Promise<TutorialView> => {
    const s = requireSession(req);
    const body = tutorialUpdateSchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'tutorial', 60, 60);
    const gift = await giftOf();
    await rowOf(deps.db, s.accountId);
    return inTransaction(deps.db, async (trx) => {
      const r = await trx.selectFrom('galaxy.tutorial').select(['chapter', 'skipped_at', 'done_at', 'gift_at']).where('account_id', '=', s.accountId).forUpdate().executeTakeFirstOrThrow();
      const now = new Date();
      if (body.action === 'skip') {
        await trx.updateTable('galaxy.tutorial').set({ skipped_at: now, updated_at: now }).where('account_id', '=', s.accountId).execute();
      } else if (body.action === 'restart') {
        await trx.updateTable('galaxy.tutorial').set({ chapter: 'hub', skipped_at: null, done_at: null, updated_at: now }).where('account_id', '=', s.accountId).execute();
      } else if (order(body.chapter) > order(r.chapter) && !r.done_at) {
        await trx
          .updateTable('galaxy.tutorial')
          .set({ chapter: body.chapter, updated_at: now, ...(body.chapter === 'done' ? { done_at: now } : {}) })
          .where('account_id', '=', s.accountId)
          .execute();
        // Reaching the station (or past it) pays the antenna's repair, once in the account's life.
        if (order(body.chapter) >= order('station') && !r.gift_at && gift > 0) {
          const won = await trx.updateTable('galaxy.tutorial').set({ gift_at: now }).where('account_id', '=', s.accountId).where('gift_at', 'is', null).returning('gift_at').executeTakeFirst();
          if (won) await credit(trx, s.accountId, 'components', gift, 'tutorial', { gift: 'antenna' });
        }
      }
      const after = await trx.selectFrom('galaxy.tutorial').select(['chapter', 'skipped_at', 'done_at', 'gift_at']).where('account_id', '=', s.accountId).executeTakeFirstOrThrow();
      return viewOf(after, gift);
    });
  });
}
