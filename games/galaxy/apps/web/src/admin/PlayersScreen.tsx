import { ADMIN_PLAYER_STATES, type AdminPlayerQuery, type AdminPlayerRow, type AdminPlayerSort, type AdminPlayerState } from '@galaxy/shared';
import { useId, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { usePlayerList } from '../api/admin';
import { errorText, useMe } from '../auth/useMe';
import { copy } from '../copy/es';
import { HScroll } from '../ui/HScroll';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { useSettled } from '../ui/useSettled';
import { cellText, Pager } from './DataTable';
import { DeletePlayerDialog } from './DeletePlayerDialog';

// The panel's players (plan «escáner pro», part F; the owner: «lista completa, con paginador, filtrado y busqueda
// profesional de usuarios, al igual que poder eliminarlos»). Everyone shows with nothing typed, 50 a page; a text finds
// names that contain it (those that start with it first), an IP or a clan's tag. The state, the order and the page live
// in the URL in Spanish, so a link or a reload keeps them. Each row leads to the player's page and may be deleted.

const t = copy.admin;
const l = t.list;

const STATE_URL: Record<AdminPlayerState, string> = { all: 'todos', online: 'conectados', active: 'activos', banned: 'baneados', muted: 'silenciados', staff: 'equipo', deleted: 'eliminados' };
const SORT_URL: Record<AdminPlayerSort, string> = { created: 'alta', name: 'nombre', seen: 'visto', level: 'nivel' };
const fromUrl = <K extends string>(map: Record<K, string>, value: string | null, fallback: K): K => (Object.entries(map) as [K, string][]).find(([, v]) => v === value)?.[0] ?? fallback;

/** Each sortable column, the order it sorts by and the direction a first click gives (names A to Z, the rest newest or highest first). */
const SORTABLE: Partial<Record<string, { sort: AdminPlayerSort; first: 'asc' | 'desc' }>> = {
  username: { sort: 'name', first: 'asc' },
  level: { sort: 'level', first: 'desc' },
  createdAt: { sort: 'created', first: 'desc' },
  lastSeen: { sort: 'seen', first: 'desc' },
};
const COLUMNS = ['username', 'level', 'clan', 'createdAt', 'lastSeen', 'state'] as const;

function StateChips({ p }: { p: AdminPlayerRow }) {
  if (p.deletedAt) return <span className="admin-chip bad">{l.deleted}</span>;
  if (!p.banned && !p.muted) return <>{t.states.ok}</>;
  return (
    <>
      {p.banned ? <span className="admin-chip bad">{t.states.banned}</span> : null}
      {p.muted ? <span className="admin-chip warn">{l.muted}</span> : null}
    </>
  );
}

export function PlayersScreen() {
  const ids = useId();
  const me = useMe().data;
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const state = fromUrl(STATE_URL, params.get('estado'), 'all');
  const sort = fromUrl(SORT_URL, params.get('orden'), 'created');
  const dir = params.get('dir') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(params.get('pagina') ?? '1') || 1);
  const q = useSettled((params.get('q') ?? '').trim().slice(0, 64), 300);
  const query: AdminPlayerQuery = { q, state, sort, dir, page };
  const list = usePlayerList(query);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Deleted from the player's page, which comes back here saying so.
  const [deleted, setDeleted] = useState<[string, string] | null>((location.state as { deleted?: [string, string] } | null)?.deleted ?? null);

  const change = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  };
  const sortBy = (col: string) => {
    const s = SORTABLE[col]!;
    const nextDir = sort === s.sort ? (dir === 'asc' ? 'desc' : 'asc') : s.first;
    change({ orden: s.sort === 'created' ? null : SORT_URL[s.sort], dir: nextDir === 'desc' ? (s.sort === 'created' ? null : 'desc') : 'asc', pagina: null });
  };
  // Who this admin may delete (the server checks it again): not themselves, never a superadmin, staff only by a superadmin.
  const deletable = (p: AdminPlayerRow) => !p.deletedAt && p.username !== me?.username && !p.roles.includes('superadmin') && (p.roles.length === 0 || !!me?.roles.includes('superadmin'));

  const data = list.data;
  return (
    <section className="admin-page">
      <h1>{t.sections.players}</h1>
      <div className="mod-toolbar players-toolbar">
        <div className="field admin-search">
          <label htmlFor={`${ids}-q`}>{t.search}</label>
          <div className="control">
            <input
              id={`${ids}-q`}
              type="search"
              value={text}
              maxLength={64}
              autoComplete="off"
              aria-describedby={`${ids}-q-hint`}
              onChange={(e) => {
                setText(e.target.value);
                change({ q: e.target.value.trim() || null, pagina: null });
              }}
            />
          </div>
          <p id={`${ids}-q-hint`} className="hint">
            {t.searchHint}
          </p>
        </div>
        <div className="field players-state">
          <label htmlFor={`${ids}-state`}>{l.state}</label>
          <div className="control">
            <Select
              id={`${ids}-state`}
              size="lg"
              block
              value={state}
              options={ADMIN_PLAYER_STATES.map((s) => ({ value: s, label: l.states[s] }))}
              onChange={(s) => change({ estado: s === 'all' ? null : STATE_URL[s], pagina: null })}
            />
          </div>
        </div>
        {data ? (
          <p className="panel-note runs-total" aria-live="polite">
            {l.total(data.total)}
          </p>
        ) : null}
      </div>
      {deleted ? (
        <p className="admin-done" role="status">
          {t.deletedAs(deleted[0], deleted[1])}
        </p>
      ) : null}
      {list.error ? (
        <p className="field-error" role="alert">
          {errorText(list.error, copy.errors)}
        </p>
      ) : null}
      {data && data.players.length === 0 ? <p className="panel-note">{l.empty}</p> : null}
      {data && data.players.length > 0 ? (
        <>
          <HScroll variant="table" className="admin-table-wrap">
            <table className="admin-table players-table" aria-busy={list.isFetching || undefined}>
              <thead>
                <tr>
                  {COLUMNS.map((c) => {
                    const s = SORTABLE[c];
                    const active = !!s && s.sort === sort;
                    return (
                      <th key={c} scope="col" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                        {s ? (
                          <button type="button" className="th-sort" data-active={active || undefined} onClick={() => sortBy(c)}>
                            <span>{t.columns[c]}</span>
                            {active ? <Icon name={dir === 'asc' ? 'up' : 'down'} /> : null}
                          </button>
                        ) : (
                          t.columns[c]
                        )}
                      </th>
                    );
                  })}
                  <th scope="col">
                    <span className="sr-only">{l.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.players.map((p) => (
                  <tr key={p.username} className={p.deletedAt ? 'is-deleted' : undefined}>
                    <td>
                      <span className="player-cell">
                        <Link to={`/admin/jugadores/${encodeURIComponent(p.username)}`}>{p.username}</Link>
                        {p.online ? <span className="admin-chip ok">{l.online}</span> : null}
                        {p.roles.length ? <span className="admin-chip staff">{t.states.staff}</span> : null}
                      </span>
                    </td>
                    <td>{p.level}</td>
                    <td>{p.clan ?? '—'}</td>
                    <td>{cellText('createdAt', p.createdAt)}</td>
                    <td>{cellText('lastSeen', p.lastSeen)}</td>
                    <td className="state-cell">
                      <StateChips p={p} />
                    </td>
                    <td className="row-actions">
                      {deletable(p) ? (
                        <button
                          type="button"
                          className="row-delete"
                          aria-haspopup="dialog"
                          aria-label={t.actions.deleteOf(p.username)}
                          onClick={() => {
                            setDeleted(null);
                            setDeleting(p.username);
                          }}
                        >
                          <Icon name="trash" />
                          <span>{t.actions.delete}</span>
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HScroll>
          <Pager page={data.page} pages={data.pages} onPage={(n) => change({ pagina: n > 1 ? String(n) : null })} />
        </>
      ) : null}
      {deleting ? (
        <DeletePlayerDialog
          username={deleting}
          onDone={(anon) => {
            setDeleted([deleting, anon]);
            setDeleting(null);
          }}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </section>
  );
}
