import { HScroll } from '../ui/HScroll';
import { ADMIN_CURRENCIES, ADMIN_SECTIONS, type AdminPlayer, type AdminSectionName, FINISHES, GALAXY_TYPES, TIERS } from '@galaxy/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAdminPlayer, usePlayerSection } from '../api/admin';
import { ApiError } from '../api/client';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';
import { ActionDialog, type FieldSpec } from './ActionDialog';
import { cellText, DataTable, Pager } from './DataTable';
import { DeletePlayerDialog } from './DeletePlayerDialog';
import { ProgressTab } from './ProgressTab';

const t = copy.admin;
const day = (iso: string) => new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
type Tab = 'summary' | 'progress' | AdminSectionName | 'sessions';
const TABS: Tab[] = ['summary', 'progress', ...ADMIN_SECTIONS, 'sessions'];
const COLUMNS: Record<AdminSectionName, string[]> = {
  galaxies: ['name', 'designation', 'tier', 'finish', 'level', 'origin', 'at', 'gone'],
  ledger: ['at', 'currency', 'delta', 'balance', 'reason'],
  pulls: ['at', 'banner', 'tier', 'finish', 'seed', 'galaxy'],
  runs: ['at', 'sector', 'probe', 'outcome', 'seconds', 'depth', 'kills', 'suspicious', 'flags'],
  market: ['at', 'kind', 'status', 'detail'],
  chat: ['at', 'channel', 'body', 'hidden'],
  social: ['at', 'kind', 'username'],
  shop: ['at', 'product', 'status', 'amount', 'refunded', 'paid'],
};

type Action = { key: string; title: string; path: string; fields?: FieldSpec[]; password: (v: Record<string, string>) => boolean; build?: (v: Record<string, string>) => Record<string, unknown>; code?: boolean };

function actionsFor(p: AdminPlayer): Action[] {
  const always = () => true;
  const never = () => false;
  return [
    {
      key: 'wallet',
      title: t.actions.wallet,
      path: 'wallet',
      fields: [
        { name: 'currency', label: t.fields.currency, kind: 'select', options: ADMIN_CURRENCIES.map((c) => [c, t.wallet[c]]) },
        { name: 'amount', label: t.fields.amount, kind: 'number', hint: t.amountHint },
      ],
      password: (v) => Number(v['amount']) < 0,
      build: (v) => ({ currency: v['currency'], amount: Number(v['amount']) }),
    },
    {
      key: 'grant',
      title: t.actions.grant,
      path: 'galaxies',
      fields: [
        { name: 'tier', label: t.fields.tier, kind: 'select', options: TIERS.map((x) => [x, copy.tiers[x]]) },
        { name: 'finish', label: t.fields.finish, kind: 'select', options: FINISHES.map((x) => [x, copy.finishes[x]]) },
        { name: 'type', label: t.fields.type, kind: 'select', options: [['', t.anyType], ...GALAXY_TYPES.map((x): [string, string] => [x, copy.traitValues.galaxy_type[x as keyof typeof copy.traitValues.galaxy_type] ?? x])] },
        { name: 'seed', label: t.fields.seed, kind: 'text', optional: true },
      ],
      password: never,
      build: (v) => ({ tier: v['tier'], finish: v['finish'], ...(v['type'] ? { type: v['type'] } : {}), ...(v['seed']?.trim() ? { seed: v['seed'].trim() } : {}) }),
    },
    { key: 'xp', title: t.actions.xp, path: 'xp', fields: [{ name: 'xp', label: t.fields.xp, kind: 'number' }], password: always, build: (v) => ({ xp: Number(v['xp']) }) },
    { key: 'rename', title: t.actions.rename, path: 'rename', fields: [{ name: 'username', label: t.fields.username, kind: 'text' }], password: always, build: (v) => ({ username: v['username']?.trim() }) },
    { key: 'resetCode', title: t.actions.resetCode, path: 'reset-code', password: always, code: true },
    { key: 'sessions', title: t.actions.sessions, path: 'sessions/close', password: never },
    p.banned
      ? { key: 'unban', title: t.actions.unban, path: 'unban', password: never }
      : {
          key: 'ban',
          title: t.actions.ban,
          path: 'ban',
          fields: [{ name: 'duration', label: t.fields.duration, kind: 'select', options: Object.entries(t.durations) }],
          password: always,
          build: (v) => ({ minutes: v['duration'] === 'forever' ? null : Number(v['duration']) }),
        },
    {
      key: 'leaderboard',
      title: p.leaderboardExcluded ? t.actions.include : t.actions.exclude,
      path: 'leaderboard',
      password: never,
      build: () => ({ excluded: !p.leaderboardExcluded }),
    },
  ];
}

function Summary({ p }: { p: AdminPlayer }) {
  return (
    <div className="admin-summary">
      <section className="lip panel">
        <h2>{t.tabs.summary}</h2>
        <p>{t.summary.level(p.level, p.xp)}</p>
        <p>{t.summary.created(day(p.createdAt))}</p>
        {p.clan ? (
          <p>
            {t.summary.clan} <span className="clan-tag">{p.clan.tag}</span> {p.clan.name}
          </p>
        ) : null}
        <dl className="admin-dl">
          {(Object.keys(p.counts) as (keyof AdminPlayer['counts'])[]).map((k) => (
            <div key={k}>
              <dt>{t.counts[k]}</dt>
              <dd>{p.counts[k]}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="lip panel">
        <h2>{t.summary.station}</h2>
        {p.station.length ? (
          <ul className="admin-list">
            {p.station.map((r) => (
              <li key={r.room}>
                {r.room} <b>{r.level}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="panel-note">{t.summary.none}</p>
        )}
        <h2>{t.summary.lab}</h2>
        <p>{p.lab.length ? p.lab.join(', ') : t.summary.none}</p>
        <h2>{t.summary.probes}</h2>
        <p>{p.probes.length ? p.probes.map((x) => `${x.probe} ${x.level}`).join(', ') : t.summary.none}</p>
      </section>
    </div>
  );
}

function Section({ username, name, onRevoke }: { username: string; name: AdminSectionName; onRevoke: (row: Record<string, unknown>) => void }) {
  const [page, setPage] = useState(1);
  const s = usePlayerSection(username, name, page);
  if (!s.data) return s.error ? <p className="field-error">{errorText(s.error, copy.errors)}</p> : null;
  return (
    <>
      <DataTable
        rows={name === 'social' ? s.data.rows.map((r) => ({ ...r, kind: t.socialKinds[String(r['kind'])] ?? r['kind'] })) : s.data.rows}
        columns={COLUMNS[name]}
        action={
          name === 'galaxies'
            ? (r) =>
                r['gone'] ? null : (
                  <button type="button" className="lip pill small danger" aria-label={t.actions.revokeOf(String(r['name']))} onClick={() => onRevoke(r)}>
                    {t.actions.revoke}
                  </button>
                )
            : name === 'runs'
              ? (r) => (
                  // Every run leads to its replay in the panel (M6d-3).
                  <Link className="lip pill small" to={`/admin/partidas/${String(r['id'])}`} aria-label={copy.admin.runs.viewOf(username)}>
                    {copy.admin.runs.view}
                  </Link>
                )
              : undefined
        }
      />
      <Pager page={s.data.page} pages={s.data.pages} onPage={setPage} />
    </>
  );
}

/** A player's page: state, balances, the changes an admin may make, and tabs with everything they have done. */
export function PlayerScreen() {
  const { username = '' } = useParams();
  const player = useAdminPlayer(username);
  const [tab, setTab] = useState<Tab>('summary');
  const [open, setOpen] = useState<Action | null>(null);
  const [done, setDone] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const p = player.data;
  if (!p) {
    return (
      <section className="admin-page">
        <Link to="/admin/jugadores" className="lip pill small">
          <Icon name="back" />
          <span>{t.sections.players}</span>
        </Link>
        {player.error ? (
          <p className="field-error" role="alert">
            {player.error instanceof ApiError ? errorText(player.error, copy.errors) : copy.errors.internal}
          </p>
        ) : null}
      </section>
    );
  }
  const actions = actionsFor(p);
  const revoke = (row: Record<string, unknown>): Action => ({ key: 'revoke', title: t.actions.revokeOf(String(row['name'])), path: `galaxies/${String(row['id'])}/revoke`, password: () => true });
  return (
    <section className="admin-page">
      <Link to="/admin/jugadores" className="lip pill small">
        <Icon name="back" />
        <span>{t.sections.players}</span>
      </Link>
      <header className="admin-player-head">
        <h1>{p.username}</h1>
        <p className="admin-chips">
          {p.deletedAt ? <span className="admin-chip bad">{t.deletedOn(day(p.deletedAt))}</span> : null}
          {p.banned ? <span className="admin-chip bad">{p.banned.permanent ? t.states.bannedForever : t.states.bannedUntil(day(p.banned.until))}</span> : <span className="admin-chip ok">{t.states.ok}</span>}
          {p.muted ? <span className="admin-chip warn">{t.states.muted(day(p.muted.until))}</span> : null}
          {p.leaderboardExcluded ? <span className="admin-chip warn">{t.states.excluded}</span> : null}
          {p.roles.length ? <span className="admin-chip staff">{p.roles.join(', ')}</span> : null}
        </p>
      </header>
      <dl className="admin-dl admin-wallet">
        {ADMIN_CURRENCIES.map((c) => (
          <div key={c}>
            <dt>{t.wallet[c]}</dt>
            <dd>{p.wallet[c]}</dd>
          </div>
        ))}
      </dl>
      {p.deletedAt ? null : (
      <div className="admin-actions">
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            className={`lip pill small${a.key === 'ban' || a.key === 'sessions' ? ' danger' : ''}`}
            aria-haspopup="dialog"
            onClick={() => {
              setDone(false);
              setOpen(a);
            }}
          >
            {a.title}
          </button>
        ))}
        <button type="button" className="lip pill small danger" aria-haspopup="dialog" onClick={() => setDeleting(true)}>
          <Icon name="trash" />
          <span>{t.actions.delete}</span>
        </button>
      </div>
      )}
      {deleting ? (
        <DeletePlayerDialog
          username={p.username}
          onDone={(anon) => navigate('/admin/jugadores', { replace: true, state: { deleted: [p.username, anon] } })}
          onClose={() => setDeleting(false)}
        />
      ) : null}
      {done ? (
        <p className="admin-done" role="status">
          {t.done}
        </p>
      ) : null}
      <HScroll className="tabs admin-tabs" role="tablist" aria-label={p.username}>
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {t.tabs[k]}
          </button>
        ))}
      </HScroll>
      <div role="tabpanel" aria-label={t.tabs[tab]}>
        {tab === 'summary' ? (
          <Summary p={p} />
        ) : tab === 'progress' ? (
          <ProgressTab username={p.username} />
        ) : tab === 'sessions' ? (
          <>
            <DataTable caption={t.sessionsTitle} rows={p.sessions} columns={['createdAt', 'expiresAt', 'ip', 'userAgent', 'mfa']} />
            <DataTable caption={t.ipsTitle} rows={p.ips.map((x) => ({ ...x, id: x.ip }))} columns={['ip', 'firstSeen', 'lastSeen']} />
          </>
        ) : (
          <Section key={tab} username={p.username} name={tab} onRevoke={(row) => setOpen(revoke(row))} />
        )}
      </div>
      {open ? (
        <ActionDialog
          url={`/admin/players/${encodeURIComponent(p.username)}/${open.path}`}
          title={open.title}
          fields={open.fields}
          password={open.password}
          build={open.build}
          result={
            open.code
              ? (r) => (
                  <div className="admin-code">
                    <p className="admin-code-value">{cellText('code', r['code'])}</p>
                    <p className="panel-note">{t.codeOnce}</p>
                    <button type="button" className="lip pill small" onClick={() => void navigator.clipboard?.writeText(String(r['code']))}>
                      {t.copy}
                    </button>
                  </div>
                )
              : undefined
          }
          onDone={(values) => {
            const renamed = open.key === 'rename' ? values['username']?.trim() : undefined;
            setOpen(null);
            setDone(true);
            // The page follows the new name (the old one no longer exists).
            if (renamed) navigate(`/admin/jugadores/${encodeURIComponent(renamed)}`, { replace: true });
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  );
}
