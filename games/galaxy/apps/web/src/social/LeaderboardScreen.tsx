import { type ClanRow, type GroupRow, type LeaderRow, type LeaderTab, SEASON_TIERS } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { Link, useSearchParams } from 'react-router';
import { useLeaderboard } from '../api/social';
import { errorText } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { clockText } from '../arena/hud/Hud';
import { spriteDataUrl } from '../arena/sprites';
import { ClanEmblem } from '../clans/ClanEmblem';
import { Avatar } from '../hub/Avatar';
import { Icon } from '../ui/Icon';
import { daysLeft, Podium, TierEmblem, tierOf } from './parts';
import { HomeLink } from '../ui/BackLink';

// The season leaderboard (GDD §14.1, §4; DESIGN_SYSTEM §8 undecies): the tabs live in the address (?pestana=) so a
// view can be shared; the podium holds the top three and the table the rest; your row is marked, and pinned below
// when it is out of the top; beside them, the season's name, the days left, the players and the tiers with yours.

const t = copy.social;
const SLUG: Record<LeaderTab, string | null> = { general: null, depth: 'profundidad', purges: 'purgas', clans: 'clanes', groups: 'grupo' };
const tabOf = (slug: string | null): LeaderTab =>
  slug === 'profundidad' ? 'depth' : slug === 'purgas' ? 'purges' : slug === 'clanes' ? 'clans' : slug === 'grupo' ? 'groups' : 'general';
const probeSprite = (id: string) => DEFAULT_CONTENT.probes.find((p) => p.id === id)?.sprite ?? 'probe-lumen';

function Row({ r, tab, mine }: { r: LeaderRow; tab: LeaderTab; mine: boolean }) {
  return (
    <tr aria-current={mine ? 'true' : undefined} className={mine ? 'mine' : undefined}>
      <td className="lb-rank">{fmt(r.rank)}</td>
      <th scope="row" className="lb-who">
        <Avatar name={r.username} avatar={r.avatar} frame={r.frame} />
        <Link to={`/perfil/${encodeURIComponent(r.username)}`}>{r.username}</Link>
        {mine ? <span className="lb-you">{t.you}</span> : null}
      </th>
      <td className="lb-level">{fmt(r.level)}</td>
      <td className="lb-value">{t.value[tab](r.value)}</td>
    </tr>
  );
}

/**
 * The En grupo tab (multiplayer plan, phase 7): each group's best run of the season, its players with their probes
 * (each name to its profile), the layer, the Cores and the time; the viewer's best group marked, or pinned below.
 */
function GroupTable({ groups, mine }: { groups: GroupRow[]; mine: GroupRow | null }) {
  const key = (g: GroupRow) => g.players.map((p) => p.username).join(',');
  const own = mine ? key(mine) : null;
  const row = (g: GroupRow) => (
    <tr key={key(g)} aria-current={own === key(g) ? 'true' : undefined} className={own === key(g) ? 'mine' : undefined}>
      <td className="lb-rank">{fmt(g.rank)}</td>
      <th scope="row" className="lb-team">
        <ul className="lb-team-list">
          {g.players.map((p) => (
            <li key={p.username}>
              <img src={spriteDataUrl(probeSprite(p.probe), 2)} alt="" />
              <Link to={`/perfil/${encodeURIComponent(p.username)}`}>{p.username}</Link>
            </li>
          ))}
        </ul>
      </th>
      <td className="lb-value">{t.value.depth(g.depth)}</td>
      <td className="lb-level">{t.value.purges(g.cores)}</td>
      <td className="lb-level">{clockText(g.seconds)}</td>
    </tr>
  );
  const head = (hidden = false) => (
    <thead className={hidden ? 'sr-only' : undefined}>
      <tr>
        <th scope="col">{t.columns.rank}</th>
        <th scope="col">{t.columns.team}</th>
        <th scope="col">{t.columns.value.groups}</th>
        <th scope="col">{t.columns.cores}</th>
        <th scope="col">{t.columns.time}</th>
      </tr>
    </thead>
  );
  if (groups.length === 0)
    return (
      <div className="lip panel lb-empty">
        <p>{t.noGroups}</p>
        <Link to="/incursion?modo=grupo" className="lip pill pill-solar">
          <Icon name="play" />
          <span>{copy.hub.play}</span>
        </Link>
      </div>
    );
  return (
    <>
      <table className="lip panel lb-table lb-groups" aria-label={t.tabs.groups}>
        {head()}
        <tbody>{groups.map(row)}</tbody>
      </table>
      {mine && !groups.some((g) => key(g) === own) ? (
        <section className="lip panel lb-pinned lb-groups" aria-label={t.yourGroup}>
          <table>
            {head(true)}
            <tbody>{row(mine)}</tbody>
          </table>
        </section>
      ) : null}
    </>
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
          <HomeLink>
            <Icon name="back" />
            <span>{t.back}</span>
          </HomeLink>
          <h1>{t.leaderboard}</h1>
          <Link to="/trofeos#salon" className="lip pill small lb-hall">
            <Icon name="trophy" />
            <span>{copy.trophies.open}</span>
          </Link>
        </header>
        <nav className="tabs lb-tabs" aria-label={t.tabsLabel}>
          {(['general', 'depth', 'purges', 'clans', 'groups'] as const).map((k) => (
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
              ) : tab === 'groups' ? (
                <GroupTable groups={v.groups ?? []} mine={v.myGroup ?? null} />
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
                  <Podium rows={v.rows} tab={tab} me={me?.username} large />
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
