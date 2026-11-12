import { type CosmeticsConfig, type CosmeticsView, portraitFor, type ProfileCosmeticsRequest } from '@galaxy/shared';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/schema';
import { HttpError } from '../errors';

// Profile cosmetics (Nov plan C2): granting avatars, frames and titles (one helper for every reward), what a player
// has and wears, and choosing. Default avatars are everyone's; everything else must be owned; the banner must be a
// galaxy of theirs (a galaxy that changes hands stops showing and is cleared when read).

type Db = Kysely<DB> | Transaction<DB>;

/** Gives the pieces of a reward that it carries (idempotent: a piece already owned stays as it was). */
export async function grantCosmetics(trx: Db, accountId: string, reward: { title?: string | null; frame?: string | null; avatar?: string | null }): Promise<void> {
  const rows = (
    [
      ['title', reward.title],
      ['frame', reward.frame],
      ['avatar', reward.avatar],
    ] as const
  )
    .filter((r): r is ['title' | 'frame' | 'avatar', string] => !!r[1])
    .map(([kind, value]) => ({ account_id: accountId, kind, value }));
  if (rows.length > 0) await trx.insertInto('galaxy.cosmetics').values(rows).onConflict((oc) => oc.doNothing()).execute();
}

/** Takes a piece away (a refunded or disputed purchase); if it was worn, it comes off. */
export async function revokeCosmetic(trx: Db, accountId: string, kind: 'title' | 'frame' | 'avatar', value: string): Promise<void> {
  await trx.deleteFrom('galaxy.cosmetics').where('account_id', '=', accountId).where('kind', '=', kind).where('value', '=', value).execute();
  await trx.updateTable('galaxy.accounts').set({ [kind]: null }).where('id', '=', accountId).where(kind, '=', value).execute();
}

/**
 * The Núcleos a run beat give their portraits, the first time (any form): the sector's own Núcleo when at least one
 * fell, and the deep one when the run went past a layer it rules (`every`) with as many Núcleos down.
 */
export async function grantPortraits(trx: Db, accountId: string, run: { boss: string; deepBoss: { boss: string; every: number } | null; depth: number; bossKills: number }): Promise<void> {
  const ids: string[] = [];
  if (run.bossKills > 0) ids.push(run.boss);
  if (run.deepBoss && run.depth >= run.deepBoss.every && run.bossKills >= run.deepBoss.every) ids.push(run.deepBoss.boss);
  for (const boss of ids) {
    const avatar = portraitFor(boss);
    if (avatar) await grantCosmetics(trx, accountId, { avatar });
  }
}

const enabledOnly = (c: CosmeticsConfig): CosmeticsConfig => ({ avatars: c.avatars.filter((a) => a.enabled), frames: c.frames.filter((f) => f.enabled), titles: c.titles.filter((t) => t.enabled) });

/** The banner shows only while the galaxy is still the player's. */
async function ownBanner(db: Db, accountId: string, banner: string | null): Promise<string | null> {
  if (!banner) return null;
  const g = await db.selectFrom('galaxy.galaxies').select('id').where('id', '=', banner).where('owner_id', '=', accountId).executeTakeFirst();
  return g ? banner : null;
}

export async function cosmeticsView(db: Db, accountId: string, cfg: CosmeticsConfig): Promise<CosmeticsView> {
  const [owned, account] = await Promise.all([
    db.selectFrom('galaxy.cosmetics').select(['kind', 'value']).where('account_id', '=', accountId).orderBy('created_at').execute(),
    db.selectFrom('galaxy.accounts').select(['avatar', 'frame', 'title', 'banner']).where('id', '=', accountId).executeTakeFirstOrThrow(),
  ]);
  const of = (kind: string) => owned.filter((o) => o.kind === kind).map((o) => o.value);
  return {
    equipped: { avatar: account.avatar, frame: account.frame, title: account.title, banner: await ownBanner(db, accountId, account.banner) },
    owned: { avatars: of('avatar'), frames: of('frame'), titles: of('title') },
    catalog: enabledOnly(cfg),
  };
}

/** Wears what was asked (only the fields sent): each piece must be the player's; null takes it off. */
export async function setProfileCosmetics(db: Db, accountId: string, req: ProfileCosmeticsRequest, cfg: CosmeticsConfig): Promise<void> {
  const owned = await db.selectFrom('galaxy.cosmetics').select(['kind', 'value']).where('account_id', '=', accountId).execute();
  const has = (kind: string, value: string) => owned.some((o) => o.kind === kind && o.value === value);
  if (req.avatar) {
    const item = cfg.avatars.find((a) => a.id === req.avatar);
    if (!item || !item.enabled) throw new HttpError(409, 'cosmetic_locked');
    if (item.source !== 'default' && !has('avatar', req.avatar)) throw new HttpError(409, 'cosmetic_locked');
  }
  if (req.frame && !has('frame', req.frame)) throw new HttpError(409, 'cosmetic_locked');
  if (req.title && !has('title', req.title)) throw new HttpError(409, 'cosmetic_locked');
  if (req.banner) {
    const g = await db.selectFrom('galaxy.galaxies').select('id').where('id', '=', req.banner).where('owner_id', '=', accountId).executeTakeFirst();
    if (!g) throw new HttpError(409, 'cosmetic_locked');
  }
  const set: Partial<Record<'avatar' | 'frame' | 'title' | 'banner', string | null>> = {};
  for (const k of ['avatar', 'frame', 'title', 'banner'] as const) if (req[k] !== undefined) set[k] = req[k] ?? null;
  if (Object.keys(set).length > 0) await db.updateTable('galaxy.accounts').set(set).where('id', '=', accountId).execute();
}
