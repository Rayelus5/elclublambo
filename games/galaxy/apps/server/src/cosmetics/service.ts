import { type BackdropView, backdropEligible, type CosmeticsConfig, type CosmeticsView, portraitFor, type ProfileCosmeticsRequest } from '@galaxy/shared';
import { type Kysely, sql, type Transaction } from 'kysely';
import type { DB } from '../db/schema';
import { HttpError } from '../errors';

// Profile cosmetics (Nov plan C2): granting avatars, frames and titles (one helper for every reward), what a player
// has and wears, and choosing. Default avatars are everyone's; everything else must be owned; the banner must be a
// galaxy of theirs (a galaxy that changes hands stops showing and is cleared when read).

type Db = Kysely<DB> | Transaction<DB>;

type Kind = 'title' | 'frame' | 'avatar' | 'skin';

/** Gives the pieces of a reward that it carries (idempotent: a piece already owned stays as it was). */
export async function grantCosmetics(trx: Db, accountId: string, reward: { title?: string | null; frame?: string | null; avatar?: string | null; skin?: string | null }): Promise<void> {
  const rows = (
    [
      ['title', reward.title],
      ['frame', reward.frame],
      ['avatar', reward.avatar],
      ['skin', reward.skin],
    ] as const
  )
    .filter((r): r is [Kind, string] => !!r[1])
    .map(([kind, value]) => ({ account_id: accountId, kind, value }));
  if (rows.length > 0) await trx.insertInto('galaxy.cosmetics').values(rows).onConflict((oc) => oc.doNothing()).execute();
}

/** Takes a piece away (a refunded or disputed purchase); if it was worn, it comes off (a skin: its probe goes back to its base). */
export async function revokeCosmetic(trx: Db, accountId: string, kind: Kind, value: string): Promise<void> {
  await trx.deleteFrom('galaxy.cosmetics').where('account_id', '=', accountId).where('kind', '=', kind).where('value', '=', value).execute();
  if (kind === 'skin') await trx.updateTable('galaxy.probe_levels').set({ skin: null }).where('account_id', '=', accountId).where('skin', '=', value).execute();
  else await trx.updateTable('galaxy.accounts').set({ [kind]: null }).where('id', '=', accountId).where(kind, '=', value).execute();
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

const enabledOnly = (c: CosmeticsConfig): CosmeticsConfig => ({ avatars: c.avatars.filter((a) => a.enabled), frames: c.frames.filter((f) => f.enabled), titles: c.titles.filter((t) => t.enabled), skins: c.skins.filter((k) => k.enabled) });

/** The banner shows only while the galaxy is still the player's. */
async function ownBanner(db: Db, accountId: string, banner: string | null): Promise<string | null> {
  if (!banner) return null;
  const g = await db.selectFrom('galaxy.galaxies').select('id').where('id', '=', banner).where('owner_id', '=', accountId).executeTakeFirst();
  return g ? banner : null;
}

/** The sky's galaxies a player chose that are still theirs (plan «escáner pro», part E), in slot order. */
async function ownBackdrop(db: Db, accountId: string): Promise<{ id: string; seed: string; traits: Record<string, string> }[]> {
  return db
    .selectFrom('galaxy.backdrops as b')
    .innerJoin('galaxy.galaxies as g', 'g.id', 'b.galaxy_id')
    .select(['g.id', 'g.seed', 'g.traits'])
    .where('b.account_id', '=', accountId)
    .where('g.owner_id', '=', accountId)
    .where('g.disintegrated_at', 'is', null)
    .orderBy('b.slot')
    .execute();
}

/** The title screen's sky: the galaxies chosen (still theirs), or the six rarest fit for it when none is. */
export async function backdropView(db: Db, accountId: string): Promise<BackdropView> {
  const chosen = (await ownBackdrop(db, accountId)).filter((g) => backdropEligible(g.traits));
  if (chosen.length > 0) return { galaxies: chosen, chosen: true };
  const rarest = await db
    .selectFrom('galaxy.galaxies')
    .select(['id', 'seed', 'traits'])
    .where('owner_id', '=', accountId)
    .where('disintegrated_at', 'is', null)
    .where(sql<string>`coalesce(traits->>'palette', '')`, '<>', 'antimatter')
    .where(sql<string>`coalesce(traits->>'phenomenon', 'none')`, '<>', 'anomaly')
    .orderBy('tier', 'desc')
    .orderBy('score', 'desc')
    .orderBy('id', 'desc')
    .limit(6)
    .execute();
  return { galaxies: rarest, chosen: false };
}

export async function cosmeticsView(db: Db, accountId: string, cfg: CosmeticsConfig): Promise<CosmeticsView> {
  const [owned, account] = await Promise.all([
    db.selectFrom('galaxy.cosmetics').select(['kind', 'value']).where('account_id', '=', accountId).orderBy('created_at').execute(),
    db.selectFrom('galaxy.accounts').select(['avatar', 'frame', 'title', 'banner']).where('id', '=', accountId).executeTakeFirstOrThrow(),
  ]);
  const of = (kind: string) => owned.filter((o) => o.kind === kind).map((o) => o.value);
  return {
    equipped: { avatar: account.avatar, frame: account.frame, title: account.title, banner: await ownBanner(db, accountId, account.banner), backdrop: (await ownBackdrop(db, accountId)).map((g) => g.id) },
    owned: { avatars: of('avatar'), frames: of('frame'), titles: of('title'), skins: of('skin') },
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
  // The sky (plan «escáner pro», part E): each one theirs and fit for it, all replaced at once.
  const backdrop = req.backdrop;
  if (backdrop && backdrop.length > 0) {
    const rows = await db.selectFrom('galaxy.galaxies').select(['id', 'traits']).where('id', 'in', backdrop).where('owner_id', '=', accountId).where('disintegrated_at', 'is', null).execute();
    if (rows.length !== backdrop.length) throw new HttpError(409, 'cosmetic_locked');
    if (rows.some((g) => !backdropEligible(g.traits))) throw new HttpError(409, 'backdrop_ineligible');
  }
  const set: Partial<Record<'avatar' | 'frame' | 'title' | 'banner', string | null>> = {};
  for (const k of ['avatar', 'frame', 'title', 'banner'] as const) if (req[k] !== undefined) set[k] = req[k] ?? null;
  if (Object.keys(set).length === 0 && !backdrop) return;
  const write = async (trx: Db) => {
    if (Object.keys(set).length > 0) await trx.updateTable('galaxy.accounts').set(set).where('id', '=', accountId).execute();
    if (backdrop) {
      await trx.deleteFrom('galaxy.backdrops').where('account_id', '=', accountId).execute();
      if (backdrop.length > 0) await trx.insertInto('galaxy.backdrops').values(backdrop.map((galaxy_id, slot) => ({ account_id: accountId, slot, galaxy_id }))).execute();
    }
  };
  if (db.isTransaction) await write(db);
  else await (db as Kysely<DB>).transaction().execute(write);
}
