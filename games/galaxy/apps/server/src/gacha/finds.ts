import {
  type FindsView,
  type FindView,
  type GachaConfig,
  generateGalaxy,
  LEGENDARY,
  MYTHIC,
  type PulledGalaxy,
  SHOWCASE_SEEDS,
  showcaseExample,
  type ShownGalaxy,
  TIERS,
  type Finish,
} from '@galaxy/shared';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema';
import { openBanners } from './service';

// What the scanner shows of what is found (2026-11-17, the owner: «Escaparate de premios» and «Últimos hallazgos»):
// - recent: the legendaries and mythics anyone found in the last 14 days (40 at most), by visible accounts only
//   (not deleted, not hidden from the rankings, not banned now), without anyone I blocked or who blocked me;
// - mine: my best scans of the week, epic and up (3);
// - showcase: what can come out, real finds first (mythics only while they can come out), topped up with examples;
// - featured: each open event scanner's featured galaxy, the last one found or an example with its trait.
// The recent list is one query for everyone, kept 30 s (and forgotten when a legendary comes out); the rest is per viewer.

const RECENT_DAYS = 14;
const RECENT_MAX = 40;
const MINE_DAYS = 7;
const MINE_MAX = 3;
const SHOWCASE_MAX = 8;
/** The showcase shows at least this many galaxies (examples fill it while there are few finds). */
const SHOWCASE_MIN = 6;
const TTL_MS = 30_000;
const EPIC = 3;
const DAY = 86_400_000;

type Recent = FindView & { accountId: string };
let cached: { at: number; rows: Promise<Recent[]> } | null = null;

/** A legendary or a mythic came out: the next look at the finds reads them again. */
export function forgetFinds(): void {
  cached = null;
}

type GalaxyRow = { gid: string; seed: string; traits: Record<string, string>; name: string; designation: string; tier: number; finish: string; featured: boolean };

function pulled(r: GalaxyRow): PulledGalaxy {
  return { id: r.gid, seed: String(r.seed), tier: TIERS[r.tier]!, finish: r.finish as Finish, traits: r.traits, name: r.name, designation: r.designation, featured: r.featured };
}

async function recent(db: Kysely<DB>, now: Date): Promise<Recent[]> {
  const rows = await db
    .selectFrom('galaxy.gacha_pulls as p')
    .innerJoin('galaxy.accounts as a', 'a.id', 'p.account_id')
    .innerJoin('galaxy.galaxies as g', 'g.id', 'p.galaxy_id')
    .select(['p.id', 'p.account_id', 'p.banner', 'p.created_at', 'p.tier', 'p.finish', 'p.featured', 'a.username', 'g.id as gid', 'g.seed', 'g.traits', 'g.name', 'g.designation'])
    .where('p.tier', '>=', LEGENDARY)
    .where('p.created_at', '>', new Date(now.getTime() - RECENT_DAYS * DAY))
    .where('a.deleted_at', 'is', null)
    .where('a.leaderboard_excluded', '=', false)
    .where((eb) => eb.or([eb('a.banned_until', 'is', null), eb('a.banned_until', '<', now)]))
    .orderBy('p.created_at', 'desc')
    .limit(RECENT_MAX)
    .execute();
  return rows.map((r) => ({ id: r.id, accountId: r.account_id, by: r.username, at: new Date(r.created_at).toISOString(), banner: r.banner, galaxy: pulled(r) }));
}

function recentCached(db: Kysely<DB>, now: Date): Promise<Recent[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rows;
  const entry = { at: Date.now(), rows: recent(db, now) };
  cached = entry;
  entry.rows.catch(() => {
    if (cached === entry) cached = null;
  });
  return entry.rows;
}

/** An event scanner's featured example: a legendary with its trait, the same for everyone (made once per trait). */
const examples = new Map<string, ShownGalaxy>();
function featuredExample(trait: string, value: string): ShownGalaxy {
  const key = `${trait}=${value}`;
  const hit = examples.get(key);
  if (hit) return hit;
  const g = generateGalaxy(20261117n, LEGENDARY, { trait: trait as never, value });
  const ex: ShownGalaxy = {
    id: `example-${g.seed}`,
    seed: g.seed.toString(),
    tier: 'legendary',
    finish: 'normal',
    traits: g.traits as unknown as Record<string, string>,
    name: g.name,
    designation: g.designation,
    featured: true,
    example: true,
  };
  examples.set(key, ex);
  return ex;
}

export async function gachaFinds(db: Kysely<DB>, cfg: GachaConfig, accountId: string, now: Date): Promise<FindsView> {
  const [all, blocks, mineRows] = await Promise.all([
    recentCached(db, now),
    db
      .selectFrom('galaxy.blocks')
      .select(['blocker', 'blocked'])
      .where((eb) => eb.or([eb('blocker', '=', accountId), eb('blocked', '=', accountId)]))
      .execute(),
    db
      .selectFrom('galaxy.gacha_pulls as p')
      .innerJoin('galaxy.galaxies as g', 'g.id', 'p.galaxy_id')
      .select(['g.id as gid', 'g.seed', 'g.traits', 'g.name', 'g.designation', 'p.tier', 'p.finish', 'p.featured'])
      .where('p.account_id', '=', accountId)
      .where('p.tier', '>=', EPIC)
      .where('p.created_at', '>', new Date(now.getTime() - MINE_DAYS * DAY))
      .orderBy('p.tier', 'desc')
      .orderBy('p.created_at', 'desc')
      .limit(MINE_MAX)
      .execute(),
  ]);
  const hidden = new Set(blocks.map((b) => (b.blocker === accountId ? b.blocked : b.blocker)));
  const seen = all.filter((r) => !hidden.has(r.accountId));
  const mythics = cfg.mythic > 0;

  const showcase: ShownGalaxy[] = [];
  const ids = new Set<string>();
  for (const r of seen) {
    if (showcase.length >= SHOWCASE_MAX) break;
    if (ids.has(r.galaxy.id) || (r.galaxy.tier === 'mythic' && !mythics)) continue;
    ids.add(r.galaxy.id);
    showcase.push(r.galaxy);
  }
  for (const s of SHOWCASE_SEEDS) {
    if (showcase.length >= SHOWCASE_MIN) break;
    if (s.tier === MYTHIC && !mythics) continue;
    showcase.push(showcaseExample(s));
  }

  const featured: Record<string, ShownGalaxy> = {};
  for (const b of openBanners(cfg, now)) {
    if (!b.featured) continue;
    const found = seen.find((r) => r.banner === b.id && r.galaxy.featured);
    featured[b.id] = found?.galaxy ?? featuredExample(b.featured.trait, b.featured.value);
  }

  return {
    recent: seen.map(({ accountId: _, ...f }) => f),
    mine: mineRows.map(pulled),
    showcase,
    featured,
  };
}
