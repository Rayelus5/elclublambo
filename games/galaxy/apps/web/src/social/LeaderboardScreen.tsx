import { type ClanRow, type LeaderRow, type LeaderTab, SEASON_TIERS } from '@galaxy/shared';
import { Link, useSearchParams } from 'react-router';
import { useLeaderboard } from '../api/social';
import { errorText } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { ClanEmblem } from '../clans/ClanEmblem';
import { Avatar } from '../hub/Avatar';
import { Icon } from '../ui/Icon';
import { daysLeft, Podium, TierEmblem, tierOf } from './parts';
import { BackLink } from '../ui/BackLink';

// The season leaderboard (GDD §14.1, §4; DESIGN_SYSTEM §8 undecies): the tabs live in the address (?pestana=) so a
// view can be shared; the podium holds the top three and the table the rest; your row is marked, and pinned below
// when it is out of the top; beside them, the season's name, the days left, the players and the tiers with yours.

const t = copy.social;
const SLUG: Record<LeaderTab, string | null> = { general: null, depth: 'profundidad', purges: 'purgas', clans: 'clanes' };
const tabOf = (slug: string | null): LeaderTab => (slug === 'profundidad' ? 'depth' : slug === 'purgas' ? 'purges' : slug === 'clanes' ? 'clans' : 'general');

function Row({ r, tab, mine }: { r: LeaderRow; tab: LeaderTab; mine: boolean }) {
  return (
    <tr aria-current={mine ? 'true' : undefined} className={mine ? 'mine' : undefined}>
      <td className="lb-rank">{fmt(r.rank)}</td>
      <th scope="row" className="lb-who">
        <Avatar name={r.username} />
        <Link to={`/perfil/${encodeURIComponent(r.username)}`}>{r.username}</Link>
        {mine ? <span className="lb-you">{t.you}</span> : null}
      </th>
      <td className="lb-level">{fmt(r.level)}</td>
      <td className="lb-value">{t.value[tab](r.value)}</td>
    </tr>
  );
}

/** The Clanes tab (M5b-1): clans by their members' season points, the viewer's clan marked or pinned below. */
function ClanTable({ clans, mine }: { clans: ClanRow[]; mine: ClanRow | null }) {
  const row = (c: ClanRow) => (
    <tr key={c.tag} aria-current={mine?.tag === c.tag ? 'true' : undefined} className={mine?.tag === c.tag ? 'mine' : undefined}>
      <td className="lb-rank">{fmt(c.rank)}</td>
      <th scope="row" className="lb-who">
        <ClanEmblem emblem={c.emblem} color={c.color} scale={1} />
        <Link to={`/clanes/${c.tag}`}>{c.name}</Link>
        <span className="clan-tag">{c.tag}</span>
      </th>
      <td className="lb-level">{fmt(c.members)}</td>
      <td className="lb-value">{copy.clans.score(c.value)}</td>
    </tr>
  );
  const head = (
    <thead>
      <tr>
        <th scope="col">{t.columns.rank}</th>
        <th scope="col">{t.tabs.clans}</th>
        <th scope="col">{copy.clans.membersTitle}</th>
        <th scope="col">{t.columns.value.clans}</th>
      </tr>
    </thead>
  );
  if (clans.length === 0) return <p className="lip panel lb-empty">{copy.clans.noClanPoints}</p>;
  return (
    <>
      <table className="lip panel lb-table" aria-label={t.tabs.clans}>
        {head}
        <tbody>{clans.map(row)}</tbody>
      </table>
      {mine && !clans.some((c) => c.tag === mine.tag) ? (
        <section className="lip panel lb-pinned" aria-label={copy.clans.yourClan}>
          <table>
            {head}
            <tbody>{row(mine)}</tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}

function Tiers({ tiers, score }: { tiers: number[]; score: number | null }) {
  const mine = score === null ? null : tierOf(score, tiers);
  return (
    <section className="lip panel lb-tiers" aria-labelledby="lb-tiers-title">
      <h2 id="lb-tiers-title">{t.tiersTitle}</h2>
      <ul aria-label={t.tiersTitle}>
        {[...SEASON_TIERS].reverse().map((tier) => {
          const at = tiers[SEASON_TIERS.indexOf(tier)] ?? 0;
          return (
            <li key={tier} data-tier={tier} aria-current={tier === mine ? 'true' : undefined}>
              <TierEmblem tier={tier} scale={1} />
              <span>
                <b>{t.tier[tier]}</b>
                <small>{t.tierFrom(at)}</small>
              </span>
              {tier === mine ? <span className="lb-you">{t.yourTier}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function LeaderboardScreen() {
  const [params] = useSearchParams();
  const tab = tabOf(params.get('pestana'));
  const board = useLeaderboard(tab);
  // The tiers go by the season's score, whatever the tab.
  const general = useLeaderboard('general');
  const v = board.data;
  const me = v?.me ?? null;
  const inTable = me !== null && v!.rows.some((r) => r.username === me.username);
  const error = errorText(board.error, copy.errors);

  return (
    <div className="screen-root leaderboard-root">
      <div className="leaderboard">
        <header className="collection-bar">
          <BackLink fallback="/">
            <Icon name="back" />
            <span>{t.back}</span>
          </BackLink>
          <h1>{t.leaderboard}</h1>
        </header>
        <nav className="tabs lb-tabs" aria-label={t.tabsLabel}>
          {(['general', 'depth', 'purges', 'clans'] as const).map((k) => (
            <Link key={k} to={SLUG[k] ? `/clasificacion?pestana=${SLUG[k]}` : '/clasificacion'} aria-current={k === tab ? 'page' : undefined}>
              {t.tabs[k]}
            </Link>
          ))}
        </nav>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        {!v ? (
          board.isPending ? (
            <p className="planetarium-wait" role="status" aria-label={copy.loading}>
              ⠋⠙⠹
            </p>
          ) : null
        ) : !v.season ? (
          <div className="lip panel lb-empty">
            <p>{copy.errors.season_closed}</p>
          </div>
        ) : (
          <div className="lb-body">
            <main className="lb-main">
              {tab === 'clans' ? (
                <ClanTable clans={v.clans ?? []} mine={v.myClan ?? null} />
              ) : v.rows.length === 0 ? (
                <div className="lip panel lb-empty">
                  <p>{t.noPoints}</p>
                  <Link to="/incursion" className="lip pill pill-solar">
                    <Icon name="play" />
                    <span>{copy.hub.play}</span>
                  </Link>
                </div>
              ) : (
                <>
                  <Podium rows={v.rows} tab={tab} me={me?.username} />
                  {v.rows.length > 3 ? (
                    <table className="lip panel lb-table" aria-label={t.leaderboard}>
                      <thead>
                        <tr>
                          <th scope="col">{t.columns.rank}</th>
                          <th scope="col">{t.columns.player}</th>
                          <th scope="col">{t.columns.level}</th>
                          <th scope="col">{t.columns.value[tab]}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {v.rows.slice(3).map((r) => (
                          <Row key={r.username} r={r} tab={tab} mine={r.username === me?.username} />
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                  {me && !inTable ? (
                    <section className="lip panel lb-pinned" aria-label={t.yourRow}>
                      <table>
                        <thead className="sr-only">
                          <tr>
                            <th scope="col">{t.columns.rank}</th>
                            <th scope="col">{t.columns.player}</th>
                            <th scope="col">{t.columns.level}</th>
                            <th scope="col">{t.columns.value[tab]}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <Row r={me} tab={tab} mine />
                        </tbody>
                      </table>
                    </section>
                  ) : null}
                </>
              )}
            </main>
            <aside className="lb-side">
              <section className="lip panel lb-season" aria-labelledby="lb-season-title">
                <h2 id="lb-season-title">{v.season.name}</h2>
                <p className="lb-ends">{t.endsIn(daysLeft(v.season.endsAt))}</p>
                {/* The season's players, whatever the tab (Purgas only counts those with a Core). */}
                <p className="lb-players">{t.players(general.data?.total ?? v.total)}</p>
              </section>
              <Tiers tiers={v.season.tiers} score={general.data?.me?.value ?? null} />
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
