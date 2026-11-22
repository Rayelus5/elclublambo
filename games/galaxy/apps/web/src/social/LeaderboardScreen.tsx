import { type ClanRow, type GroupRow, type LeaderRow, type LeaderTab } from '@galaxy/shared';
import { useId } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useLeaderboard, useSeasonsHistory } from '../api/social';
import { errorText, isAdmin, useMe } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { clockText } from '../arena/hud/Hud';
import { probeDrawing, spriteDataUrl } from '../arena/sprites';
import { ClanEmblem } from '../clans/ClanEmblem';
import { Avatar } from '../hub/Avatar';
import { Icon } from '../ui/Icon';
import { Podium } from './parts';
import { SeasonCard } from './SeasonCard';
import { HomeLink } from '../ui/BackLink';
import { useContentNames } from '../api/content-names';
import { PreviewBanner, seasonSpan } from '../season/SeasonPreview';
import { Select, type SelectOption } from '../ui/Select';
import { PastBoard } from './PastSeason';

// The season leaderboard (GDD §14.1, §4; DESIGN_SYSTEM §8 undecies): the tabs live in the address (?pestana=) so a
// view can be shared; the podium holds the top three and the table the rest (in General with each player's runs and
// best layer, 2026-11-21), scrolling inside its own box; your row is marked, and pinned below when it is out of the
// top; beside them, the season card (SeasonCard), which leads to the season's route and shop. A selector chooses the
// season (plan «temporadas como fichas», histórico, 2026-11-22), also in the address (?temporada=): the current one, or
// a closed one with its final General ranking (PastSeason.tsx; the other tabs are not kept). An admin with a season
// still to come in the address sees its preview: its card as it will open, with nobody on it, and a way back to the
// panel. For players, a season that is neither closed nor current in the address just shows the current one.

const t = copy.social;
const SLUG: Record<LeaderTab, string | null> = { general: null, depth: 'profundidad', purges: 'purgas', clans: 'clanes', groups: 'grupo' };
const tabOf = (slug: string | null): LeaderTab =>
  slug === 'profundidad' ? 'depth' : slug === 'purgas' ? 'purges' : slug === 'clanes' ? 'clans' : slug === 'grupo' ? 'groups' : 'general';

/** The General tab adds each player's runs and best layer; the columns hide when the table is narrow (app.css). */
const hasExtra = (tab: LeaderTab) => tab === 'general';

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
      {hasExtra(tab) ? (
        <>
          <td className="lb-extra">{fmt(r.runs ?? 0)}</td>
          <td className="lb-extra">{fmt(r.bestDepth ?? 0)}</td>
        </>
      ) : null}
      <td className="lb-value">{t.value[tab](r.value)}</td>
    </tr>
  );
}

/** The solo tabs' column heads (only for screen readers in the pinned row, which sits under the table's). */
function SoloHead({ tab, hidden = false }: { tab: LeaderTab; hidden?: boolean }) {
  return (
    <thead className={hidden ? 'sr-only' : undefined}>
      <tr>
        <th scope="col">{t.columns.rank}</th>
        <th scope="col">{t.columns.player}</th>
        <th scope="col">{t.columns.level}</th>
        {hasExtra(tab) ? (
          <>
            <th scope="col" className="lb-extra">
              {t.columns.runs}
            </th>
            <th scope="col" className="lb-extra">
              {t.columns.bestDepth}
            </th>
          </>
        ) : null}
        <th scope="col">{t.columns.value[tab]}</th>
      </tr>
    </thead>
  );
}

/**
 * The En grupo tab (multiplayer plan, phase 7): each group's best run of the season, its players with their probes
 * (each name to its profile), the layer, the Cores and the time; the viewer's best group marked, or pinned below.
 */
function GroupTable({ groups, mine }: { groups: GroupRow[]; mine: GroupRow | null }) {
  const { probeSprite } = useContentNames();
  const key = (g: GroupRow) => g.players.map((p) => p.username).join(',');
  const own = mine ? key(mine) : null;
  const row = (g: GroupRow) => (
    <tr key={key(g)} aria-current={own === key(g) ? 'true' : undefined} className={own === key(g) ? 'mine' : undefined}>
      <td className="lb-rank">{fmt(g.rank)}</td>
      <th scope="row" className="lb-team">
        <ul className="lb-team-list">
          {g.players.map((p) => (
            <li key={p.username}>
              <img src={spriteDataUrl(probeDrawing(p.skin, probeSprite(p.probe)), 2)} alt="" />
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

/** What the leaderboard shows: the current season, a closed one, an admin's preview, or not known yet. */
export type BoardMode = 'live' | 'past' | 'preview' | 'loading';

/**
 * The mode for the season in the address (`wanted`): closed seasons (`past`), the current one's id (`liveId`, null
 * between seasons) and whether the viewer is an admin with TOTP; `undefined` while that is still loading.
 */
export function boardMode({ wanted, past, liveId, admin }: { wanted: string | null; past: readonly string[] | undefined; liveId: string | null | undefined; admin: boolean | undefined }): BoardMode {
  if (!wanted) return 'live';
  if (past === undefined) return 'loading';
  if (past.includes(wanted)) return 'past';
  if (liveId === undefined) return 'loading';
  if (wanted === liveId) return 'live';
  if (admin === undefined) return 'loading';
  return admin ? 'preview' : 'live';
}

const wait = (
  <p className="planetarium-wait" role="status" aria-label={copy.loading}>
    ⠋⠙⠹
  </p>
);

export function LeaderboardScreen() {
  const [params, setParams] = useSearchParams();
  const wanted = params.get('temporada') || null;
  const viewer = useMe();
  const history = useSeasonsHistory();
  // The season card goes by the season's score and players, whatever the tab.
  const general = useLeaderboard('general');
  const mode = boardMode({
    wanted,
    past: history.data ? history.data.seasons.map((s) => s.id) : history.error ? [] : undefined,
    liveId: general.data ? (general.data.season?.id ?? null) : general.error ? null : undefined,
    admin: !wanted ? false : viewer.data !== undefined ? isAdmin(viewer.data) && !!viewer.data?.mfa : viewer.error ? false : undefined,
  });
  // A past season keeps only its General ranking: a tab in the address waits for the current season.
  const tab = mode === 'live' ? tabOf(params.get('pestana')) : 'general';
  const board = useLeaderboard(tab, { enabled: mode === 'live' });
  const preview = useLeaderboard('general', { season: wanted, enabled: mode === 'preview' });
  const v = board.data;
  const me = v?.me ?? null;
  const inTable = me !== null && v!.rows.some((r) => r.username === me.username);
  const error = errorText(mode === 'preview' ? preview.error : mode === 'live' ? board.error : null, copy.errors);
  const note = useId();
  const pastSeasons = history.data?.seasons ?? [];
  const shown = mode === 'live' ? '' : (wanted ?? '');
  const ahead = mode === 'preview' ? preview.data?.season : null;
  const options: SelectOption[] = [
    { value: '', label: t.currentSeason },
    ...(ahead ? [{ value: ahead.id, label: ahead.name, hint: copy.season.preview.option }] : []),
    ...pastSeasons.map((s) => ({ value: s.id, label: s.name, hint: seasonSpan(s.startsAt, s.endsAt) })),
  ];

  return (
    <div className="screen-root leaderboard-root">
      <div className="leaderboard">
        <header className="collection-bar">
          <HomeLink>
            <Icon name="back" />
            <span>{t.back}</span>
          </HomeLink>
          <h1>{t.leaderboard}</h1>
          {pastSeasons.length > 0 || ahead ? (
            <Select className="lb-pick" size="sm" aria-label={t.seasonPick} value={shown} options={options} onChange={(id) => setParams(id ? { temporada: id } : {})} />
          ) : null}
          <Link to="/trofeos#salon" className="lip pill small lb-hall">
            <Icon name="trophy" />
            <span>{copy.trophies.open}</span>
          </Link>
        </header>
        {mode === 'live' ? (
          <nav className="tabs lb-tabs" aria-label={t.tabsLabel}>
            {(['general', 'depth', 'purges', 'clans', 'groups'] as const).map((k) => (
              <Link key={k} to={SLUG[k] ? `/clasificacion?pestana=${SLUG[k]}` : '/clasificacion'} aria-current={k === tab ? 'page' : undefined}>
                {t.tabs[k]}
              </Link>
            ))}
          </nav>
        ) : null}
        {mode === 'past' && wanted ? (
          <div className="lb-past-tabs">
            <nav className="tabs lb-tabs" aria-label={t.tabsLabel} aria-describedby={note}>
              {(['general', 'depth', 'purges', 'clans', 'groups'] as const).map((k) =>
                k === 'general' ? (
                  <Link key={k} to={`/clasificacion?temporada=${encodeURIComponent(wanted)}`} aria-current="page">
                    {t.tabs[k]}
                  </Link>
                ) : (
                  <button key={k} type="button" disabled>
                    {t.tabs[k]}
                  </button>
                ),
              )}
            </nav>
            <p id={note} className="lb-past-note">
              <Icon name="info" />
              <span>{t.past.onlyGeneral}</span>
            </p>
          </div>
        ) : null}
        {ahead ? <PreviewBanner name={ahead.name} startsAt={ahead.startsAt} endsAt={ahead.endsAt} hint={copy.season.preview.boardHint} /> : null}
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        {mode === 'loading' ? (
          wait
        ) : mode === 'past' && wanted ? (
          <PastBoard id={wanted} />
        ) : mode === 'preview' ? (
          !ahead ? (
            preview.isPending ? wait : null
          ) : (
            <div className="lb-body">
              <main className="lb-main">
                <div className="lip panel lb-empty">
                  <p>{copy.social.noPoints}</p>
                </div>
              </main>
              <aside className="lb-side">
                <SeasonCard season={ahead} me={null} total={0} preview />
              </aside>
            </div>
          )
        ) : !v ? (
          board.isPending ? wait : null
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
                    <div className="lip panel lb-scroll">
                      <table className="lb-table" aria-label={t.leaderboard}>
                        <SoloHead tab={tab} />
                        <tbody>
                          {v.rows.slice(3).map((r) => (
                            <Row key={r.username} r={r} tab={tab} mine={r.username === me?.username} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  {me && !inTable ? (
                    <section className="lip panel lb-pinned" aria-label={t.yourRow}>
                      <table>
                        <SoloHead tab={tab} hidden />
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
              {/* Your score and the season's players, whatever the tab (Purgas only counts those with a Core). */}
              <SeasonCard season={v.season} me={general.data?.me ?? null} total={general.data?.total ?? v.total} />
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
