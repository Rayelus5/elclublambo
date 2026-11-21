import { type LeaderRow, type SeasonInfo, type SeasonReward, SEASON_TIERS } from '@galaxy/shared';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { copy, fmt } from '../copy/es';
import { Icon, type IconName } from '../ui/Icon';
import { TierEmblem, tierProgress } from './parts';
import { SeasonCountdown } from './SeasonCountdown';

// The leaderboard's season card (GDD §13.1, §14.1; DESIGN_SYSTEM §8 undecies; 2026-11-21): the season's name with its
// live countdown, your place and your tier with the way to the next one, every tier with what the close pays it, the
// podium's prize and the players. The whole card leads to the season's route and shop: one link whose hit area covers
// the card (the «Ver ruta y tienda» at its foot names it), so nothing else in it is interactive and a screen reader
// hears a short link, not the whole card. Every number comes from the server: the thresholds, the prizes and the
// podium's size are live config.

const t = copy.social;

type Chip = { key: string; icon: IconName; text: string; kind: 'coins' | 'dust' | 'signal' | 'shards' | 'cosmetic' };

/** A prize as drawn chips: each currency with its amount, then each piece with its name. */
function chipsOf(r: SeasonReward): Chip[] {
  const out: Chip[] = [];
  if (r.coins) out.push({ key: 'coins', icon: 'coin', text: fmt(r.coins), kind: 'coins' });
  if (r.dust) out.push({ key: 'dust', icon: 'dust', text: fmt(r.dust), kind: 'dust' });
  if (r.signal) out.push({ key: 'signal', icon: 'ticket', text: fmt(r.signal), kind: 'signal' });
  if (r.shards) out.push({ key: 'shards', icon: 'shard', text: fmt(r.shards), kind: 'shards' });
  if (r.title) out.push({ key: 'title', icon: 'trophy', text: t.prizeChip.title(r.title), kind: 'cosmetic' });
  if (r.frame) out.push({ key: 'frame', icon: 'star', text: t.prizeChip.frame(r.frame), kind: 'cosmetic' });
  if (r.avatar) out.push({ key: 'avatar', icon: 'starOn', text: t.prizeChip.avatar(r.avatar), kind: 'cosmetic' });
  if (r.skin) out.push({ key: 'skin', icon: 'probe', text: t.prizeChip.skin(r.skin), kind: 'cosmetic' });
  return out;
}

/** A closing prize: the chips drawn, and the same in words for screen readers. */
function Prizes({ reward, trophy = false }: { reward: SeasonReward; trophy?: boolean }) {
  const chips = chipsOf(reward);
  return (
    <span className="lb-prizes">
      <span className="sr-only">
        {t.prize(reward)}
        {trophy ? `, ${t.podiumTrophyLabel}` : ''}
      </span>
      <span className="lb-prize-chips" aria-hidden="true">
        {chips.length === 0 && !trophy ? <span className="lb-prize none">{t.noPrize}</span> : null}
        {chips.map((c) => (
          <span key={c.key} className={`lb-prize k-${c.kind}`}>
            <Icon name={c.icon} />
            {c.text}
          </span>
        ))}
        {trophy ? (
          <span className="lb-prize k-cosmetic">
            <Icon name="podium" />
            {t.podiumTrophy}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * The season card: `me` is the viewer's General row (null without points) and `total` the season's players, both from
 * the General tab whatever tab is open.
 */
export function SeasonCard({ season, me, total }: { season: SeasonInfo; me: LeaderRow | null; total: number }) {
  const score = me?.value ?? 0;
  const { tier, next, from, to, share } = tierProgress(score, season.tiers);
  const mine = me ? tier : null;
  const { closing } = season;
  return (
    <section className="lip panel lb-season" aria-labelledby="lb-season-title">
      <div className="lb-season-head">
        <h2 id="lb-season-title">{season.name}</h2>
        {/* The card's way in, also in sight when its foot is below the fold. */}
        <span className="lb-season-go" aria-hidden="true">
          <Icon name="next" />
        </span>
        <p className="lb-ends">
          <Icon name="comet" />
          <SeasonCountdown endsAt={season.endsAt} />
        </p>
      </div>

      <div className="lb-me">
        {me ? <b className="lb-standing-rank">{t.rankOf(me.rank, total)}</b> : null}
        <div className="lb-standing">
          {tier ? (
            <TierEmblem tier={tier} scale={2} />
          ) : next ? (
            <span className="lb-standing-ghost" aria-hidden="true">
              <TierEmblem tier={next.tier} scale={2} />
            </span>
          ) : null}
          <div>
            <span className="lb-standing-tier">{tier ? t.tier[tier] : t.noTier}</span>
            <span className="lb-standing-points">{t.value.general(score)}</span>
          </div>
        </div>
        {next && to !== null ? (
          <div className="lb-next">
            <span className="lb-tier-bar" role="progressbar" aria-label={t.tierBar(t.tier[next.tier])} aria-valuemin={from} aria-valuemax={to} aria-valuenow={score}>
              <i style={{ '--share': share } as CSSProperties} />
            </span>
            <p>{t.toNext(next.points, t.tier[next.tier])}</p>
          </div>
        ) : (
          <p className="lb-next">{copy.season.allTiers}</p>
        )}
      </div>

      <div className="lb-prizes-block">
        <h3>{t.prizesTitle}</h3>
        <p className="lb-prizes-hint">{t.prizesHint}</p>
        <ul className="lb-tier-list" aria-label={t.tiersTitle}>
          {[...SEASON_TIERS].reverse().map((x) => {
            const i = SEASON_TIERS.indexOf(x);
            const reward = closing.tiers[i];
            return (
              <li key={x} data-tier={x} aria-current={x === mine ? 'true' : undefined}>
                <TierEmblem tier={x} scale={1} />
                <span className="lb-tier-name">
                  <b>{t.tier[x]}</b>
                  <small>{t.tierFrom(season.tiers[i] ?? 0)}</small>
                </span>
                {x === mine ? <span className="lb-you">{t.yourTier}</span> : null}
                {reward ? <Prizes reward={reward} /> : null}
              </li>
            );
          })}
        </ul>
        {closing.podiumSize > 0 ? (
          <div className="lb-podium-prize" role="group" aria-label={t.podiumPrize}>
            <span className="lb-podium-icon" aria-hidden="true">
              <Icon name="podium" />
            </span>
            <span className="lb-tier-name">
              <b>{t.podiumTitle}</b>
              <small>{t.podiumWho(closing.podiumSize)}</small>
            </span>
            <Prizes reward={closing.podium} trophy />
          </div>
        ) : null}
      </div>

      <div className="lb-season-foot">
        <span className="lb-players">{t.players(total)}</span>
        <Link to="/temporada" className="lb-season-link">
          <span className="lip pill small pill-solar">
            <span>{t.seeRoute}</span>
            <Icon name="next" />
          </span>
        </Link>
      </div>
    </section>
  );
}
