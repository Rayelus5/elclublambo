import { accountSettingsSchema, type AccountSettings, type SettingsView } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { requireSession } from '../auth/guards';
import type { DB } from '../db/schema';
import { hitRateLimit } from '../ratelimit';

// The player's settings on the account (plan «ajustes en la cuenta»): one row per account with what Ajustes holds,
// checked on the way in (accountSettingsSchema drops what it does not know) and replaced whole on each save. The
// browser applies them over its own copy once signed in, and saves again a moment after each change.

function viewOf(row: { data: unknown; updated_at: Date | string } | undefined): SettingsView {
  if (!row) return { settings: null, updatedAt: null };
  // A row written by an older or newer schema reads as what is still valid of it.
  const parsed = accountSettingsSchema.safeParse(row.data);
  return { settings: parsed.success ? parsed.data : null, updatedAt: new Date(row.updated_at).toISOString() };
}

export function registerSettingsRoutes(api: FastifyInstance, deps: { db: Kysely<DB> }): void {
  api.get('/galaxy/api/settings', async (req): Promise<SettingsView> => {
    const s = requireSession(req);
    return viewOf(await deps.db.selectFrom('galaxy.settings').select(['data', 'updated_at']).where('account_id', '=', s.accountId).executeTakeFirst());
  });

  api.put('/galaxy/api/settings', async (req): Promise<SettingsView> => {
    const s = requireSession(req);
    const body: AccountSettings = accountSettingsSchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'settings', 60, 60);
    const now = new Date();
    const data = JSON.stringify(body);
    await deps.db
      .insertInto('galaxy.settings')
      .values({ account_id: s.accountId, data, updated_at: now })
      .onConflict((oc) => oc.column('account_id').doUpdateSet({ data, updated_at: now }))
      .execute();
    return { settings: body, updatedAt: now.toISOString() };
  });
}
