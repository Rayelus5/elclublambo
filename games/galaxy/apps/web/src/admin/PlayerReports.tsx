import { HScroll } from '../ui/HScroll';
import type { PlayerReportPage } from '@galaxy/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ADMIN_KEY } from '../api/admin';
import { api } from '../api/client';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { useModDialog } from './ModerationScreen';

// Moderación › Jugadores (multiplayer plan, phase 7): the reports of players from group runs, newest first; each one
// with who, whom, why and its note, a link to the reported player's run, and a review (dismissed or actioned, with a
// reason; audited). Mutes and bans stay where they are (Silencios, the player's page).

const t = copy.admin.moderation;
const p = t.playerReports;
const at = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function PlayerReports() {
  const reports = useQuery({
    queryKey: [...ADMIN_KEY, 'player-reports', 1],
    queryFn: () => api<PlayerReportPage>('/admin/moderation/player-reports?page=1'),
    placeholderData: keepPreviousData,
  });
  const dialog = useModDialog();
  const rows = reports.data?.reports ?? [];
  const review = (id: string, title: string, outcome: 'dismissed' | 'actioned') =>
    dialog.start({ title, submit: p.submit, url: `/admin/moderation/player-reports/${id}`, build: () => ({ outcome }) });
  return (
    <div className="mod-pane">
      <p className="panel-note">
        {p.live}
        {reports.data ? `, ${p.count(reports.data.total)}` : ''}
      </p>
      {dialog.view}
      {reports.error ? (
        <p className="field-error" role="alert">
          {errorText(reports.error, copy.errors)}
        </p>
      ) : null}
      {reports.data && rows.length === 0 ? <p className="panel-note">{p.none}</p> : null}
      {rows.length > 0 ? (
        <HScroll variant="table" className="admin-table-wrap">
          <table className="admin-table" aria-label={t.tabs.players}>
            <thead>
              <tr>
                {(['at', 'reported', 'reporter', 'reason', 'note', 'run', 'actions'] as const).map((c) => (
                  <th key={c} scope="col">
                    {p.cols[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{at.format(new Date(r.at))}</td>
                  <td>
                    <Link to={`/admin/jugadores/${r.reported}`}>{r.reported}</Link>
                  </td>
                  <td>{r.reporter}</td>
                  <td>{copy.coop.report.reasons[r.reason]}</td>
                  <td className="mod-note">{r.note ?? ''}</td>
                  <td>
                    {r.reportedRunId ? (
                      <Link to={`/admin/partidas/${r.reportedRunId}`} aria-label={p.replayOf(r.reported)}>
                        {p.replay}
                      </Link>
                    ) : null}
                  </td>
                  <td className="admin-room-actions">
                    <button type="button" className="lip pill small" aria-haspopup="dialog" aria-label={p.dismissOf(r.reported)} onClick={() => review(r.id, p.dismissOf(r.reported), 'dismissed')}>
                      {p.dismiss}
                    </button>
                    <button type="button" className="lip pill small" aria-haspopup="dialog" aria-label={p.actOf(r.reported)} onClick={() => review(r.id, p.actOf(r.reported), 'actioned')}>
                      {p.act}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScroll>
      ) : null}
    </div>
  );
}
