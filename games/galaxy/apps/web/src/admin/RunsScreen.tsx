import { HScroll } from '../ui/HScroll';
import type { AdminRunRow } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAdminRuns } from '../api/admin-runs';
import { clockText } from '../arena/hud/Hud';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { useSettled } from '../ui/useSettled';
import { Pager } from './DataTable';

// The panel's runs (GDD §16.2, §16.6; M6d-3): every run, newest first, by player and «sospechosas», each leading to its
// replay. The filters live in the URL, so a link or a reload keeps them.

const t = copy.admin.runs;
const date = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' });

/** A sector's or a probe's name from the content the game ships with (an id it does not know stays as it is). */
export const sectorName = (id: string) => DEFAULT_CONTENT.sectors.find((s) => s.id === id)?.name ?? id;
export const probeName = (id: string) => DEFAULT_CONTENT.probes.find((p) => p.id === id)?.name ?? id;
export const outcomeText = (o: AdminRunRow['outcome']) => t.outcomes[o ?? 'open'];

export function RunsScreen() {
  const ids = useId();
  const [params, setParams] = useSearchParams();
  const suspicious = params.get('sospechosas') === '1';
  const group = params.get('grupo') === '1';
  const page = Math.max(1, Number(params.get('pagina') ?? '1') || 1);
  const [player, setPlayer] = useState(params.get('jugador') ?? '');
  // Only a whole name is looked for (the server matches it exactly): half-typed ones wait instead of erroring.
  const typed = (params.get('jugador') ?? '').trim().toLowerCase();
  const settled = useSettled(/^[a-z0-9_]{3,20}$/.test(typed) ? typed : '', 300);
  const runs = useAdminRuns({ player: settled || undefined, suspicious, group, page });
  const change = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  };
  const data = runs.data;
  return (
    <section className="admin-page">
      <h1>{copy.admin.sections.runs}</h1>
      <div className="mod-toolbar">
        <div className="field">
          <label htmlFor={`${ids}-player`}>{t.player}</label>
          <div className="control">
            <input
              id={`${ids}-player`}
              type="search"
              value={player}
              maxLength={20}
              autoComplete="off"
              onChange={(e) => {
                setPlayer(e.target.value);
                change({ jugador: e.target.value.trim() || null, pagina: null });
              }}
            />
          </div>
          <p className="hint">{t.playerHint}</p>
        </div>
        <button type="button" className="lip pill small" aria-pressed={suspicious} onClick={() => change({ sospechosas: suspicious ? null : '1', pagina: null })}>
          {t.onlySuspicious}
        </button>
        <button type="button" className="lip pill small" aria-pressed={group} onClick={() => change({ grupo: group ? null : '1', pagina: null })}>
          {t.onlyGroup}
        </button>
        {data ? <p className="panel-note runs-total">{t.total(data.total)}</p> : null}
      </div>
      {runs.error ? (
        <p className="field-error" role="alert">
          {errorText(runs.error, copy.errors)}
        </p>
      ) : null}
      {data && data.runs.length === 0 ? <p className="panel-note">{t.empty}</p> : null}
      {data && data.runs.length > 0 ? (
        <>
          <HScroll variant="table" className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  {(['at', 'player', 'sector', 'probe', 'outcome', 'seconds', 'depth', 'kills', 'suspicious'] as const).map((c) => (
                    <th key={c} scope="col">
                      {c === 'player' ? t.player : c === 'seconds' ? t.details.seconds : copy.admin.cols[c]}
                    </th>
                  ))}
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {data.runs.map((r) => (
                  <tr key={r.id} className={r.suspicious ? 'run-row flagged' : 'run-row'}>
                    <td>{date.format(new Date(r.startedAt))}</td>
                    <td>
                      <Link to={`/admin/jugadores/${r.player}`}>{r.player}</Link>
                      {r.party ? <span className="run-party">{t.party(r.party)}</span> : null}
                    </td>
                    <td>{sectorName(r.sector)}</td>
                    <td>{probeName(r.probe)}</td>
                    <td>{outcomeText(r.outcome)}</td>
                    <td>{r.seconds === null ? '—' : clockText(r.seconds)}</td>
                    <td>{r.depth ?? '—'}</td>
                    <td>{r.kills ?? '—'}</td>
                    <td>{r.suspicious ? <span className="run-flag">{t.marked}</span> : copy.admin.no}</td>
                    <td>
                      <Link className="lip pill small" to={`/admin/partidas/${r.id}`} aria-label={t.viewOf(r.player)}>
                        {t.view}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HScroll>
          <Pager page={data.page} pages={data.pages} onPage={(p) => change({ pagina: p > 1 ? String(p) : null })} />
        </>
      ) : null}
    </section>
  );
}
