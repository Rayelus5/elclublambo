import { randomBytes } from 'node:crypto';
import { ENGINE_VERSION } from '@galaxy/engine';
import {
  bannerOdds,
  drawPull,
  FINISHES,
  generateGalaxy,
  TIERS,
  type Banner,
  type BannerView,
  type GachaConfig,
  type GachaView,
  type PityState,
  type PulledGalaxy,
  type PullRequest,
  type PullResponse,
  type SeasonConfig,
  seasonFinish,
} from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { madridDay } from '../economy/day';
import { credit, debit, getWallet } from '../economy/wallet';
import { HttpError } from '../errors';
import type { WithLive } from '../realtime/notices';
import { convertLeftovers, unseenLeftovers } from './leftovers';

// Deep scan (GDD §9) on the server: it decides every pull. Payment, luck state, galaxies and the audit row commit
// in one transaction, inside an idempotent operation (routes.ts). Seeds come from crypto; the outcome from the pure
// rules in @galaxy/shared, so any pull can be replayed from its audit row.
/** `live`: the live hub, for an achievement's notice (real-time notices plan). */
export type GachaDeps = { db: Kysely<DB>; config: ConfigReader; now: () => Date } & WithLive;

/** A banner is open between its optional startsAt and endsAt. */
export function openBanners(cfg: GachaConfig, now: Date): Banner[] {
  const t = now.getTime();
  return cfg.banners.filter(
    (b) => (!b.startsAt || Date.parse(b.startsAt) <= t) && (!b.endsAt || t < Date.parse(b.endsAt)),
  );
}

/** First visit: the welcome signals and the welcome luck, exactly once (a conditional UPDATE picks the winner). */
async function ensureWelcome(trx: Kysely<DB>, accountId: string, cfg: GachaConfig): Promise<void> {
  await trx.insertInto('galaxy.gacha_accounts').values({ account_id: accountId }).onConflict((oc) => oc.doNothing()).execute();
  const won = await trx
    .updateTable('galaxy.gacha_accounts')
    .set({ welcome_granted_at: new Date() })
    .where('account_id', '=', accountId)
    .where('welcome_granted_at', 'is', null)
    .returning('account_id')
    .executeTakeFirst();
  if (!won) return;
  if (cfg.welcome.signals > 0) await credit(trx, accountId, 'signal', cfg.welcome.signals, 'welcome', {}, `welcome:${accountId}`);
  await trx
    .insertInto('galaxy.gacha_state')
    .values({ account_id: accountId, pity_group: 'standard', welcome: true })
    .onConflict((oc) => oc.doNothing())
    .execute();
}

async function readState(trx: Kysely<DB>, accountId: string, group: string, lock: boolean): Promise<PityState> {
  if (lock) {
    await trx.insertInto('galaxy.gacha_state').values({ account_id: accountId, pity_group: group }).onConflict((oc) => oc.doNothing()).execute();
  }
  let q = trx
    .selectFrom('galaxy.gacha_state')
    .select(['since_legendary', 'since_featured', 'welcome'])
    .where('account_id', '=', accountId)
    .where('pity_group', '=', group);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  return { sinceLegendary: row?.since_legendary ?? 0, sinceFeatured: row?.since_featured ?? 0, welcome: row?.welcome ?? false };
}

async function freePullAvailable(db: Kysely<DB>, accountId: string, cfg: GachaConfig, now: Date): Promise<boolean> {
  if (!cfg.dailyFree) return false;
  // A DATE column comes back from pg as a JS Date: read it as YYYY-MM-DD text to compare it with the Madrid day.
  const row = await db
    .selectFrom('galaxy.gacha_accounts')
    .select(sql<string | null>`to_char(last_free_day, 'YYYY-MM-DD')`.as('day'))
    .where('account_id', '=', accountId)
    .executeTakeFirst();
  return !row?.day || row.day < madridDay(now);
}

export async function gachaView(db: Kysely<DB>, cfg: GachaConfig, accountId: string, now: Date): Promise<GachaView> {
  const banners: BannerView[] = [];
  for (const b of openBanners(cfg, now)) {
    const state = await readState(db, accountId, b.pityGroup, false);
    banners.push({
      id: b.id,
      kind: b.kind,
      name: b.name,
      currency: b.currency,
      ...(b.featured ? { featured: b.featured } : {}),
      ...(b.endsAt ? { endsAt: b.endsAt } : {}),
      ...bannerOdds(state, b, cfg),
    });
  }
  return { banners, costs: cfg.costs, freePullAvailable: await freePullAvailable(db, accountId, cfg, now), wallet: await getWallet(db, accountId) };
}

async function requireEnabled(config: ConfigReader): Promise<GachaConfig> {
  return (await enabledGacha(config)).cfg;
}

/**
 * The gacha config a pull will use and its version, read BEFORE the operation's transaction: an economy operation holds
 * one pooled connection, and reading the config through the pool inside it would need a second one.
 */
export async function enabledGacha(config: ConfigReader): Promise<{ cfg: GachaConfig; version: number }> {
  if (!(await config.get('features')).gacha) throw new HttpError(503, 'gacha_disabled');
  const { value, version } = await config.getVersioned('gacha');
  return { cfg: value, version };
}

/** GET /gacha: the first visit also gives the welcome. */
export async function visit(deps: GachaDeps, accountId: string): Promise<GachaView> {
  const cfg = await requireEnabled(deps.config);
  // Read before the transaction (one pooled connection each): the events keep their signals alive while they run.
  const events = (await deps.config.get('events')).list;
  const now = deps.now();
  await inTransaction(deps.db, async (trx) => {
    await ensureWelcome(trx, accountId, cfg);
    await convertLeftovers(trx, accountId, cfg, events, now);
  });
  return { ...(await gachaView(deps.db, cfg, accountId, now)), leftovers: await unseenLeftovers(deps.db, accountId) };
}

const randomSeed = () => randomBytes(8).readBigUInt64BE();

/** The pull itself, inside the caller's operation transaction. */
export async function pull(
  deps: GachaDeps,
  trx: Kysely<DB>,
  accountId: string,
  req: PullRequest,
  opKey: string,
  gacha: { cfg: GachaConfig; version: number },
  /** The season open now (M8c), read before the transaction: its exclusive finish and its origin seal. */
  season: SeasonConfig | null = null,
): Promise<PullResponse> {
  const { cfg } = gacha;
  const now = deps.now();
  const banner = openBanners(cfg, now).find((b) => b.id === req.banner);
  if (!banner) throw new HttpError(409, 'banner_closed');
  await ensureWelcome(trx, accountId, cfg);

  const ref = { banner: banner.id, count: req.count };
  if (req.pay === 'free') {
    if (req.count !== 1 || banner.kind !== 'standard' || !cfg.dailyFree) throw new HttpError(400, 'invalid_input');
    const today = madridDay(now);
    const used = await trx
      .updateTable('galaxy.gacha_accounts')
      .set({ last_free_day: today })
      .where('account_id', '=', accountId)
      .where((eb) => eb.or([eb('last_free_day', 'is', null), eb('last_free_day', '<', today)]))
      .returning('account_id')
      .executeTakeFirst();
    if (!used) throw new HttpError(409, 'free_pull_used');
  } else if (req.pay === 'coins') {
    const cost = req.count === 10 ? cfg.costs.coinsTen : cfg.costs.coins;
    await debit(trx, accountId, 'coins', cost, 'gacha', ref, opKey);
  } else {
    await debit(trx, accountId, banner.currency, cfg.costs.signals * req.count, 'gacha', ref, opKey);
  }

  let state = await readState(trx, accountId, banner.pityGroup, true);
  const pulls: PulledGalaxy[] = [];
  for (let i = 0; i < req.count; i++) {
    const pullSeed = randomSeed();
    const drawn = drawPull(pullSeed, state, banner, cfg);
    const outcome = { ...drawn, finish: seasonFinish(pullSeed, season) ?? drawn.finish };
    const g = generateGalaxy(pullSeed, outcome.tier, outcome.featured ? banner.featured : undefined);
    const row = await trx
      .insertInto('galaxy.galaxies')
      .values({
        owner_id: accountId,
        seed: g.seed.toString(),
        engine_version: ENGINE_VERSION,
        traits: JSON.stringify(g.traits),
        dna: g.dna,
        name: g.name,
        designation: g.designation,
        tier: outcome.tier,
        score: g.score,
        finish: outcome.finish,
        featured: outcome.featured,
        origin: 'pull',
        // The origin seal (GDD §8.4): the season it was born in.
        season: season?.id ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('galaxy.gacha_pulls')
      .values({
        account_id: accountId,
        banner: banner.id,
        pity_group: banner.pityGroup,
        seed: pullSeed.toString(),
        tier: outcome.tier,
        featured: outcome.featured,
        finish: outcome.finish,
        pity_before: state.sinceLegendary,
        config_version: gacha.version,
        engine_version: ENGINE_VERSION,
        galaxy_id: row.id,
        operation_key: opKey,
      })
      .execute();
    pulls.push({
      id: row.id,
      seed: g.seed.toString(),
      tier: TIERS[outcome.tier]!,
      finish: FINISHES[FINISHES.indexOf(outcome.finish)]!,
      traits: g.traits as unknown as Record<string, string>,
      name: g.name,
      designation: g.designation,
      featured: outcome.featured,
    });
    state = outcome.state;
  }
  await trx
    .updateTable('galaxy.gacha_state')
    .set((eb) => ({
      since_legendary: state.sinceLegendary,
      since_featured: state.sinceFeatured,
      welcome: state.welcome,
      total_pulls: eb('total_pulls', '+', req.count),
    }))
    .where('account_id', '=', accountId)
    .where('pity_group', '=', banner.pityGroup)
    .execute();
  return { pulls, wallet: await getWallet(trx, accountId), view: await gachaView(trx, cfg, accountId, now) };
}
