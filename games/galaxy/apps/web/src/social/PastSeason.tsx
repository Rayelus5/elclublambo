import { type PastRow, type SeasonResults, type SeasonStats, SEASON_TIERS } from '@galaxy/shared';
import { type CSSProperties, useId } from 'react';
import { Link } from 'react-router';
import { useContentNames } from '../api/content-names';
import { useSeasonResults } from '../api/social';
import { errorText } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { Avatar } from '../hub/Avatar';
import { seasonSpan } from '../season/SeasonPreview';
import { Icon } from '../ui/Icon';
import { Podium, TierEmblem } from './parts';
import { ClosingPrizes } from './SeasonCard';

// A past season on the leaderboard (plan «temporadas como fichas», histórico para jugadores, 2026-11-22; DESIGN_SYSTEM
// §8 undecies): its final General ranking as it closed (the podium, then the table with each player's tier, a page at
// a time with «Ver más»), your row marked or pinned below like the live one, and beside it the season's card (its
// days, your result and what its close paid each tier) and its numbers frozen at the close (players, runs, enemies,
// Cores, extractions, the deepest layer, the sector and probe played most, and how many reached each tier). Nothing
// here leads to the season's shop: it is over.

const t = copy.social;
const pt = t.past;

/** The tier a past row finished in: its emblem and its name. */
function TierCell({ tier }: { tier: PastRow['tier'] }) {
  return (
    <span className="lb-past-tier">
      {tier ? <TierEmblem tier={tier} scale={1} /> : null}
      <span>{tier ? t.tier[tier] : pt.noTier}</span>
    </span>
  );
}

function Line({ r, mine }: { r: PastRow; mine: boolean }) {
  return (
    <tr aria-current={mine ? 'true' : undefined} className={mine ? 'mine' : undefined}>
      <td className="lb-rank">{fmt(r.rank)}</td>
      <th scope="row" className="lb-who">
        <Avatar name={r.username} avatar={r.avatar} frame={r.frame} />
        <Link to={`/perfil/${encodeURIComponent(r.username)}`}>{r.username}</Link>
        {mine ? <span className="lb-you">{t.you}</span> : null}
      </th>
      <td className="lb-level">{fmt(r.level)}</td>
      <td className="lb-extra lb-past-tier-cell">
        <TierCell tier={r.tier} />
      </td>
      <td className="lb-value">{t.value.general(r.value)}</td>
    </tr>
  );
}

/** The final ranking's column heads (only for screen readers in the pinned row). */
function Head({ hidden = false }: { hidden?: boolean }) {
  return (
    <thead className={hidden ? 'sr-only' : undefined}>
      <tr>
        <th scope="col">{t.columns.rank}</th>
        <th scope="col">{t.columns.player}</th>
        <th scope="col">{t.columns.level}</th>
        <th scope="col" className="lb-extra">
          {pt.tierColumn}
        </th>
        <th scope="col">{t.columns.value.general}</th>
      </tr>
    </thead>
  );
}

/** The past season's card: its name and days, your result in it, and what its close paid. */
function PastCard({ season, me, total }: { season: SeasonResults['season']; me: PastRow | null; total: number }) {
  const title = useId();
  return (
    <section className="lip panel lb-past" aria-labelledby={title}>
      <div className="lb-past-head">
        <h2 id={title}>{season.name}</h2>
        <span className="lb-past-chip">{pt.ended}</span>
        <p className="lb-past-span">
          <Icon name="calendar" />
          <span>{seasonSpan(season.startsAt, season.endsAt)}</span>
        </p>
      </div>
      <div className="lb-me" role="group" aria-label={pt.yourResult}>
        {me ? (
          <>
            <b className="lb-standing-rank">{t.rankOf(me.rank, total)}</b>
            <div className="lb-standing">
              {me.tier ? <TierEmblem tier={me.tier} scale={2} /> : null}
              <div>
                <span className="lb-standing-tier">{me.tier ? t.tier[me.tier] : pt.noTier}</span>
                <span className="lb-standing-points">{t.value.general(me.value)}</span>
              </div>
            </div>
            {me.podium ? (
              <p className="lb-past-podium">
                <Icon name="podium" />
                <span>{pt.podium}</span>
              </p>
            ) : null}
          </>
        ) : (
          <p className="lb-next">{pt.notPlayed}</p>
        )}
      </div>
      {season.closing ? <ClosingPrizes tiers={season.tiers} closing={season.closing} mine={me?.tier ?? null} title={pt.prizesTitle} hint={pt.prizesHint} /> : null}
    </section>
  );
}

/** The season's numbers, frozen at its close (only its players for a season closed before they were kept). */
function StatsCard({ stats, players }: { stats: SeasonStats | null; players: number }) {
  const title = useId();
  const names = useContentNames();
  const figures: [string, string, boolean?][] = stats
    ? [
        [pt.stats.players, fmt(stats.players)],
        [pt.stats.runs, fmt(stats.runs)],
        [pt.stats.kills, fmt(stats.kills)],
        [pt.stats.cores, fmt(stats.cores)],
        [pt.stats.extractions, fmt(stats.extractions)],
        [pt.stats.maxDepth, fmt(stats.maxDepth)],
        [pt.stats.topSector, stats.topSector ? names.sectorName(stats.topSector) : pt.none, true],
        [pt.stats.topProbe, stats.topProbe ? names.probeName(stats.topProbe) : pt.none, true],
      ]
    : [[pt.stats.players, fmt(players)]];
  return (
    <section className="lip panel lb-stats" aria-labelledby={title}>
      <h2 id={title}>{pt.statsTitle}</h2>
      <dl className="lb-stats-grid">
        {figures.map(([label, value, wide]) => (
          <div key={label} className={wide ? 'wide' : undefined}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {stats ? (
        <div className="lb-reached-block">
          <h3>{pt.tiersReached}</h3>
          <ul className="lb-reached" aria-label={pt.tiersReached}>
            {[...SEASON_TIERS].reverse().map((x) => (
              <li key={x} data-tier={x}>
                <TierEmblem tier={x} scale={1} />
                <b>{t.tier[x]}</b>
                <span className="lb-reached-n">{t.players(stats.tiers[x])}</span>
                <span className="lb-reached-bar" aria-hidden="true">
                  <i style={{ '--share': stats.players > 0 ? stats.tiers[x] / stats.players : 0 } as CSSProperties} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="panel-note">{pt.noStats}</p>
      )}
    </section>
  );
}

/** A closed season's final ranking with its card and its numbers. */
export function PastBoard({ id }: { id: string }) {
  const q = useSeasonResults(id);
  const first = q.data?.pages[0];
  if (q.error)
    return (
      <p className="field-error" role="alert">
        {errorText(q.error, copy.errors)}
      </p>
    );
  if (!first)
    return (
      <p className="planetarium-wait" role="status" aria-label={copy.loading}>
        ⠋⠙⠹
      </p>
    );
  const rows = q.data!.pages.flatMap((p) => p.rows);
  const me = first.me;
  const inTable = me !== null && rows.some((r) => r.username === me.username);
  return (
    <div className="lb-body">
      <main className="lb-main">
        {rows.length === 0 ? (
          <div className="lip panel lb-empty">
            <p>{pt.empty}</p>
          </div>
        ) : (
          <>
            <Podium rows={rows} tab="general" me={me?.username} large />
            {rows.length > 3 ? (
              <div className="lip panel lb-scroll">
                <table className="lb-table lb-past-table" aria-label={t.leaderboard}>
                  <Head />
                  <tbody>
                    {rows.slice(3).map((r) => (
                      <Line key={r.username} r={r} mine={r.username === me?.username} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {q.hasNextPage ? (
              <button type="button" className="lip pill lb-more" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                <Icon name="down" />
                <span>{q.isFetchingNextPage ? pt.loadingMore : pt.more}</span>
              </button>
            ) : null}
            {me && !inTable ? (
              <section className="lip panel lb-pinned lb-past-table" aria-label={t.yourRow}>
                <table>
                  <Head hidden />
                  <tbody>
                    <Line r={me} mine />
                  </tbody>
                </table>
              </section>
            ) : null}
          </>
        )}
      </main>
      <aside className="lb-side">
        <PastCard season={first.season} me={me} total={first.total} />
        <StatsCard stats={first.season.stats} players={first.season.players} />
      </aside>
    </div>
  );
}
