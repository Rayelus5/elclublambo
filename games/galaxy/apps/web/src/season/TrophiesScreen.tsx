import type { HallOfFame, SeasonHistory } from '@galaxy/shared';
import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, useId } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import { errorText, useMe } from '../auth/useMe';
import { copy } from '../copy/es';
import { TierEmblem } from '../social/parts';
import { BackLink } from '../ui/BackLink';
import { Icon } from '../ui/Icon';

// The trophy room (GDD §10, §13.1; M7d-2, DESIGN_SYSTEM §8 tricies): your closed seasons, the podium ones as trophies,
// and the hall of fame with every closed season's podium. The profile shows the same history.

const t = copy.trophies;
const PLACE = ['gold', 'silver', 'bronze'] as const;

/** A player's closed seasons, newest first (the profile and the trophy room). */
export function SeasonHistoryList({ username }: { username: string }) {
  const history = useQuery({
    queryKey: ['seasons', username],
    queryFn: () => api<SeasonHistory>(`/profiles/${encodeURIComponent(username)}/seasons`),
    enabled: username !== '',
  });
  const v = history.data;
  if (history.error) return <p className="field-error">{errorText(history.error, copy.errors)}</p>;
  if (!v) return <p className="profile-empty">{copy.loading}</p>;
  if (v.seasons.length === 0) return <p className="profile-empty">{t.noHistory}</p>;
  return (
    <ol className="season-history">
      {v.seasons.map((s) => (
        <li key={s.season} className={s.podium ? 'podium' : undefined} style={{ '--place': `var(--place-${PLACE[s.rank - 1] ?? 'none'})` } as CSSProperties}>
          {s.podium ? (
            <span className="trophy" aria-hidden="true">
              <Icon name="trophy" />
            </span>
          ) : s.tier ? (
            <TierEmblem tier={s.tier} scale={1} />
          ) : (
            <span className="trophy none" aria-hidden="true" />
          )}
          <span className="season-history-text">
            <b>{s.name}</b>
            <span>{t.place(s.rank, s.score)}</span>
          </span>
          <span className="season-history-tier">{s.podium ? t.podiumPlace(s.rank) : s.tier ? copy.social.tier[s.tier] : copy.social.noTier}</span>
        </li>
      ))}
    </ol>
  );
}

export function TrophiesScreen() {
  const me = useMe().data;
  const hall = useQuery({ queryKey: ['hall-of-fame'], queryFn: () => api<HallOfFame>('/hall-of-fame') });
  const mine = useId();
  const fame = useId();
  return (
    <div className="screen-root missions-root">
      <div className="missions trophies">
        <header className="collection-bar">
          <BackLink fallback="/estacion" />
          <h1>{t.title}</h1>
        </header>
        <section className="lip panel trophies-mine" aria-labelledby={mine}>
          <h2 id={mine}>{t.mine}</h2>
          {me ? <SeasonHistoryList username={me.username} /> : null}
        </section>
        <section className="trophies-hall" id="salon" aria-labelledby={fame}>
          <h2 id={fame}>{t.hall}</h2>
          {hall.error ? <p className="field-error">{errorText(hall.error, copy.errors)}</p> : null}
          {hall.data && hall.data.seasons.length === 0 ? <p className="lip panel empty">{t.noHall}</p> : null}
          <ul>
            {hall.data?.seasons.map((s) => (
              <li key={s.season} className="lip panel">
                <div className="hall-head">
                  <b>{s.name}</b>
                  <span>{t.players(s.players)}</span>
                </div>
                <ol className="hall-podium">
                  {s.podium.map((p) => (
                    <li key={p.username} style={{ '--place': `var(--place-${PLACE[p.rank - 1] ?? 'none'})` } as CSSProperties}>
                      <span className="trophy" aria-hidden="true">
                        <Icon name="trophy" />
                      </span>
                      <Link to={`/perfil/${encodeURIComponent(p.username)}`}>{p.username}</Link>
                      <span>{t.place(p.rank, p.score)}</span>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        </section>
        <p className="panel-note">
          <Link to="/temporada">{copy.social.route}</Link>
        </p>
      </div>
    </div>
  );
}
