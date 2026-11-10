import { type CSSProperties, useId } from 'react';
import { Link } from 'react-router';
import { useLeaderboard } from '../api/social';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';
import { daysLeft, nextTier, Podium, TierEmblem, tierOf } from './parts';

// The title screen's right column (GDD §4, DESIGN_SYSTEM §8 undecies): the season with its days left, the podium, your
// place with your tier and what the next one asks for, and the way into the whole leaderboard.

const t = copy.social;

export function SeasonSummary() {
  const board = useLeaderboard('general');
  const title = useId();
  const mine = useId();
  const v = board.data;
  const me = v?.me ?? null;
  const tier = v?.season && me ? tierOf(me.value, v.season.tiers) : null;
  const next = v?.season && me ? nextTier(me.value, v.season.tiers) : null;
  return (
    <aside className="lip panel season-summary enter" style={{ '--d': '1.1s' } as CSSProperties} aria-labelledby={title}>
      <div className="hd">
        <Icon name="podium" />
        <div>
          <h2 id={title}>{v?.season?.name ?? t.leaderboard}</h2>
          <span>{v?.season ? t.endsIn(daysLeft(v.season.endsAt)) : v || board.error ? '' : copy.loading}</span>
        </div>
      </div>
      {!v && board.error ? (
        <p className="empty" role="alert">
          {errorText(board.error, copy.errors)}
        </p>
      ) : !v ? (
        <p className="empty" role="status">
          {copy.loading}
        </p>
      ) : !v.season ? (
        <p className="empty">{copy.errors.season_closed}</p>
      ) : (
        <>
          {v.rows.length > 0 ? <Podium rows={v.rows} tab="general" me={me?.username} /> : null}
          {me ? (
            <section className="season-me" aria-labelledby={mine}>
              <h3 id={mine}>{t.yourRow}</h3>
              <div className="season-me-row">
                {tier ? <TierEmblem tier={tier} scale={2} /> : null}
                <span>
                  <b>{t.rank(me.rank)}</b>
                  <span>{t.value.general(me.value)}</span>
                  <span className="season-me-tier">{tier ? t.tier[tier] : t.noTier}</span>
                </span>
              </div>
              {next ? <p className="season-next">{t.toNext(next.points, t.tier[next.tier])}</p> : null}
            </section>
          ) : (
            <p className="empty">{t.noPoints}</p>
          )}
          <p className="season-players">{t.players(v.total)}</p>
          <Link to="/temporada" className="lip more more-season">
            {t.route}
          </Link>
          <Link to="/clasificacion" className="lip more">
            {t.seeAll}
          </Link>
        </>
      )}
    </aside>
  );
}
