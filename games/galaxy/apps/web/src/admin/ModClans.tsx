import { useId, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { useAdminClan, useAdminClans } from '../api/moderation';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';
import { useSettled } from '../ui/useSettled';
import { ActionDialog } from './ActionDialog';
import { cellText } from './DataTable';
import type { ModAction } from './ModerationScreen';

const t = copy.admin.moderation.clans;

/** Clans (admins only): by tag or name, the newest with nothing written; each leads to its page. */
export function ClanList() {
  const id = useId();
  const location = useLocation();
  const [q, setQ] = useState('');
  const settled = useSettled(q.trim(), 300);
  const clans = useAdminClans(settled);
  const rows = clans.data ?? [];
  const dissolved = (location.state as { dissolved?: boolean } | null)?.dissolved;
  return (
    <div className="mod-pane">
      {dissolved ? (
        <p className="admin-done" role="status">
          {copy.admin.done}
        </p>
      ) : null}
      <div className="field admin-search">
        <label htmlFor={id}>{t.search}</label>
        <div className="control">
          <input id={id} type="search" value={q} maxLength={64} autoComplete="off" onChange={(e) => setQ(e.target.value)} />
        </div>
        <p className="hint">{t.hint}</p>
      </div>
      {clans.error ? (
        <p className="field-error" role="alert">
          {errorText(clans.error, copy.errors)}
        </p>
      ) : null}
      {clans.data && rows.length === 0 ? <p className="panel-note">{t.none}</p> : null}
      {rows.length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                {(['tag', 'name', 'members', 'leader', 'createdAt'] as const).map((c) => (
                  <th key={c} scope="col">
                    {t.cols[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.tag}>
                  <td>
                    <Link to={`/admin/moderacion/clanes/${encodeURIComponent(c.tag)}`}>{c.tag}</Link>
                  </td>
                  <td>{c.name}</td>
                  <td>{c.members}</td>
                  <td>{c.leader ?? t.noLeader}</td>
                  <td>{cellText('createdAt', c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** A clan's page: its data and roster; rename, clear the description, kick, hand the lead over, dissolve. */
export function ClanPage() {
  const tag = useParams().tag ?? '';
  const navigate = useNavigate();
  const clan = useAdminClan(tag);
  const [open, setOpen] = useState<(ModAction & { key: string }) | null>(null);
  const [done, setDone] = useState(false);
  const back = (
    <Link to="/admin/moderacion/clanes" className="lip pill small">
      <Icon name="back" />
      <span>{t.back}</span>
    </Link>
  );
  const c = clan.data;
  if (!c) {
    return (
      <div className="mod-pane">
        {back}
        {clan.error ? (
          <p className="field-error" role="alert">
            {clan.error instanceof ApiError && clan.error.code === 'clan_not_found' ? t.gone : errorText(clan.error, copy.errors)}
          </p>
        ) : null}
      </div>
    );
  }
  const base = `/admin/clans/${encodeURIComponent(c.tag)}`;
  const start = (a: ModAction & { key: string }) => {
    setDone(false);
    setOpen(a);
  };
  const rename = {
    key: 'edit',
    title: t.edit,
    submit: t.edit,
    url: `${base}/edit`,
    fields: [
      { name: 'name', label: t.name, kind: 'text' as const, hint: t.optional, optional: true },
      { name: 'tag', label: t.tag, kind: 'text' as const, hint: t.optional, optional: true },
    ],
    build: (v: Record<string, string>) => ({ ...(v['name']?.trim() ? { name: v['name'].trim() } : {}), ...(v['tag']?.trim() ? { tag: v['tag'].trim().toUpperCase() } : {}) }),
  };
  return (
    <div className="mod-pane admin-clan">
      {back}
      <header className="admin-player-head">
        <h2>{`[${c.tag}] ${c.name}`}</h2>
        <p className="admin-chips">
          <span className={`admin-chip ${c.open ? 'ok' : ''}`}>{c.open ? t.open : t.closed}</span>
        </p>
      </header>
      <p className="admin-clan-desc">{c.description || t.noDescription}</p>
      <div className="admin-actions">
        <button type="button" className="lip pill small" aria-haspopup="dialog" onClick={() => start(rename)}>
          {t.edit}
        </button>
        {c.description ? (
          <button type="button" className="lip pill small" aria-haspopup="dialog" onClick={() => start({ key: 'clear', title: t.clearDescription, submit: t.clearDescription, url: `${base}/edit`, build: () => ({ description: '' }) })}>
            {t.clearDescription}
          </button>
        ) : null}
        <button type="button" className="lip pill small danger" aria-haspopup="dialog" onClick={() => start({ key: 'dissolve', title: t.dissolve, submit: t.dissolve, url: `${base}/dissolve`, password: true })}>
          {t.dissolve}
        </button>
      </div>
      {done ? (
        <p className="admin-done" role="status">
          {copy.admin.done}
        </p>
      ) : null}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <caption>{t.rosterTitle}</caption>
          <thead>
            <tr>
              {(['name', 'role', 'joinedAt', 'actions'] as const).map((k) => (
                <th key={k} scope="col">
                  {t.cols[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.roster.map((m) => (
              <tr key={m.username}>
                <td>{m.username}</td>
                <td>{copy.clans.roles[m.role]}</td>
                <td>{cellText('at', m.joinedAt)}</td>
                <td>
                  <div className="admin-row-actions">
                    {m.role !== 'leader' ? (
                      <button
                        type="button"
                        className="lip pill small"
                        aria-haspopup="dialog"
                        aria-label={t.leaderOf(m.username)}
                        onClick={() => start({ key: 'leader', title: t.leaderOf(m.username), submit: t.makeLeader, url: `${base}/leader`, build: () => ({ username: m.username }) })}
                      >
                        {t.makeLeader}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="lip pill small danger"
                      aria-haspopup="dialog"
                      aria-label={t.kickOf(m.username)}
                      onClick={() => start({ key: 'kick', title: t.kickOf(m.username), submit: t.kick, url: `${base}/kick`, build: () => ({ username: m.username }) })}
                    >
                      {t.kick}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open ? (
        <ActionDialog
          url={open.url}
          title={open.title}
          submit={open.submit}
          fields={open.fields}
          password={() => !!open.password}
          build={open.build}
          onDone={(values) => {
            setOpen(null);
            if (open.key === 'dissolve') return void navigate('/admin/moderacion/clanes', { state: { dissolved: true } });
            setDone(true);
            // The page follows a new tag (the old one no longer exists).
            const next = open.key === 'edit' ? values['tag']?.trim().toUpperCase() : undefined;
            if (next) navigate(`/admin/moderacion/clanes/${encodeURIComponent(next)}`, { replace: true });
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
