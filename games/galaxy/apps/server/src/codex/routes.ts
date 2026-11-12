import { type CodexProgress, levelOf } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { type Kysely, sql } from 'kysely';
import { requireSession } from '../auth/guards';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { accountXp } from '../social/progress';

// The Códice (GDD §15; M7b-2): what the account has done that opens its entries — per sector, the longest run, the
// Cores purged and the most purged in one run (Nov plan B4: the forms of its Core); the deepest layer; the account
// level. Suspicious runs count for nothing. The web holds the texts and the rules (codex/entries.ts).

export function registerCodexRoutes(api: FastifyInstance, deps: { db: Kysely<DB>; config: ConfigReader }): void {
  api.get('/galaxy/api/codex', async (req): Promise<CodexProgress> => {
    const s = requireSession(req);
    const [rows, xp, account] = await Promise.all([
      deps.db
        .selectFrom('galaxy.runs')
        .select([
          'sector',
          sql<number>`coalesce(max(seconds), 0)::int`.as('maxSeconds'),
          sql<number>`coalesce(sum(boss_kills), 0)::int`.as('bossKills'),
          sql<number>`coalesce(max(boss_kills), 0)::int`.as('maxBossKills'),
          sql<number>`coalesce(max(depth), 0)::int`.as('maxDepth'),
        ])
        .where('account_id', '=', s.accountId)
        .where('finished_at', 'is not', null)
        .where('suspicious', '=', false)
        .groupBy('sector')
        .execute(),
      accountXp(deps.db, s.accountId),
      deps.config.get('account'),
    ]);
    return {
      sectors: Object.fromEntries(rows.map((r) => [r.sector, { maxSeconds: r.maxSeconds, bossKills: r.bossKills, maxBossKills: r.maxBossKills }])),
      bossKills: rows.reduce((n, r) => n + r.bossKills, 0),
      maxDepth: rows.reduce((n, r) => Math.max(n, r.maxDepth), 0),
      level: levelOf(xp, account).level,
    };
  });
}
