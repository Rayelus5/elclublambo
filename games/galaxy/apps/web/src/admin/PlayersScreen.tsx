import { useId, useState } from 'react';
import { Link } from 'react-router';
import { usePlayerSearch } from '../api/admin';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { useSettled } from '../ui/useSettled';
import { cellText } from './DataTable';

const t = copy.admin;

/** Finding a player by name (prefix), an IP or a clan's tag. */
export function PlayersScreen() {
  const id = useId();
  const [q, setQ] = useState('');
  const settled = useSettled(q.trim(), 300);
  const search = usePlayerSearch(settled);
  const rows = search.data?.players ?? [];
  return (
    <section className="admin-page">
      <h1>{t.sections.players}</h1>
      <div className="field admin-search">
        <label htmlFor={id}>{t.search}</label>
        <div className="control">
          <input id={id} type="search" value={q} maxLength={64} autoComplete="off" onChange={(e) => setQ(e.target.value)} />
        </div>
        <p className="hint">{t.searchHint}</p>
      </div>
      {search.error ? (
        <p className="field-error" role="alert">
          {errorText(search.error, copy.errors)}
        </p>
      ) : null}
      {settled && search.data && rows.length === 0 ? <p className="panel-note">{t.noResults}</p> : null}
      {rows.length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                {(['username', 'level', 'clan', 'createdAt', 'lastSeen', 'state'] as const).map((c) => (
                  <th key={c} scope="col">
                    {t.columns[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.username}>
                  <td>
                    <Link to={`/admin/jugadores/${encodeURIComponent(p.username)}`}>{p.username}</Link>
                    {p.roles.length ? <span className="admin-chip staff">{t.states.staff}</span> : null}
                  </td>
                  <td>{p.level}</td>
                  <td>{p.clan ?? '—'}</td>
                  <td>{cellText('createdAt', p.createdAt)}</td>
                  <td>{cellText('lastSeen', p.lastSeen)}</td>
                  <td>{p.banned ? <span className="admin-chip bad">{t.states.banned}</span> : t.states.ok}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
