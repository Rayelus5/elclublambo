import { type Leaderboard, type LeaderTab, seasonConfigOf, type SeasonInfo, seasonOpen } from '@galaxy/shared';
import { HttpError } from '../errors';
import { seasonById } from '../season/records';
import { leaderboard, type SocialDeps } from './leaderboard';

// An admin's preview of another season's leaderboard (the panel's «Temporadas», plan «temporadas como fichas»,
// 2026-11-22): a draft or a season still to come, as the leaderboard will show it once it opens. Its name, dates,
// tiers and closing prizes come from its record; nobody has played it, so every tab is empty. The season open now is
// the live leaderboard itself. Its own module: the leaderboard is read by the season's close, which records reach.

/** The leaderboard of season `id` as it will look (the live one when `id` is the open season); 404 without it. */
export async function previewLeaderboard(deps: SocialDeps, viewerId: string, id: string, tab: LeaderTab): Promise<Leaderboard> {
  const row = await seasonById(deps.db, id);
  if (!row) throw new HttpError(404, 'season_not_found');
  const live = await deps.config.get('season');
  if (live.id === row.id && seasonOpen(live, deps.now())) return leaderboard(deps, viewerId, tab);
  const cfg = seasonConfigOf(row);
  const { tiers, podium, podiumSize } = row.route.closing;
  const season: SeasonInfo = { id: cfg.id, name: cfg.name, startsAt: cfg.startsAt, endsAt: cfg.endsAt, tiers: [...cfg.tiers], closing: { tiers: [...tiers], podium, podiumSize } };
  const empty: Leaderboard = { season, tab, rows: [], me: null, total: 0 };
  if (tab === 'clans') return { ...empty, clans: [], myClan: null };
  if (tab === 'groups') return { ...empty, groups: [], myGroup: null };
  return empty;
}
