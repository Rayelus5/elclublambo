import { type LeaderRow, type LeaderTab, SEASON_TIERS, type SeasonTier } from '@galaxy/shared';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { copy } from '../copy/es';
import { Avatar } from '../hub/Avatar';
import { tierArtUrl } from './tiers';

// Pieces the leaderboard, the title screen and the profiles share (DESIGN_SYSTEM §8 undecies): a tier's animated
// emblem, the podium and the season's numbers.

const t = copy.social;
const DAY = 86_400_000;

/** The tier a score reaches, by the season's thresholds (Bronce to Estelar), or null under the first. */
export function tierOf(score: number, tiers: readonly number[]): SeasonTier | null {
  let tier: SeasonTier | null = null;
  tiers.forEach((at, i) => {
    if (score >= at) tier = SEASON_TIERS[i] ?? tier;
  });
  return tier;
}

/** The next tier above a score and the points it still needs, or null at the top. */
export function nextTier(score: number, tiers: readonly number[]): { tier: SeasonTier; points: number } | null {
  const i = tiers.findIndex((at) => score < at);
  return i < 0 ? null : { tier: SEASON_TIERS[i]!, points: tiers[i]! - score };
}

/** Whole days left: under a day it ends today, under two it ends tomorrow. */
export function daysLeft(endsAt: string, now = Date.now()): number {
  return Math.max(0, Math.floor((Date.parse(endsAt) - now) / DAY));
}

/** A tier's emblem (the 32×32 Aseprite strip at ×1 or ×2, playing its shine); decorative, the name goes beside it. */
export function TierEmblem({ tier, scale = 2 }: { tier: SeasonTier; scale?: 1 | 2 }) {
  const url = tierArtUrl(tier);
  return <span className="tier-art" data-tier={tier} aria-hidden="true" style={{ '--size': `${32 * scale}px`, ...(url ? { backgroundImage: `url(${url})` } : {}) } as CSSProperties} />;
}

/** The top three, first in the middle on screen (in order for screen readers), each leading to its profile. */
export function Podium({ rows, tab, me }: { rows: LeaderRow[]; tab: LeaderTab; me: string | undefined }) {
  return (
    <ol className="podium" aria-label={t.podium}>
      {rows.slice(0, 3).map((r, i) => (
        <li key={r.username} className={`place-${i + 1}`} aria-current={r.username === me ? 'true' : undefined}>
          <span className="sr-only">{t.rank(r.rank)}</span>
          <Link to={`/perfil/${encodeURIComponent(r.username)}`} className="podium-who">
            <span className="podium-avatar">
              <Avatar name={r.username} />
            </span>
            <b>{r.username}</b>
          </Link>
          <span className="podium-level">{t.level(r.level)}</span>
          <span className="podium-value">{t.value[tab](r.value)}</span>
          <span className="podium-step" aria-hidden="true">
            {r.rank}
          </span>
        </li>
      ))}
    </ol>
  );
}
