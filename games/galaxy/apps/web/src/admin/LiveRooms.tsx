import { HScroll } from '../ui/HScroll';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { Link } from 'react-router';
import { useAdminRooms, useAdminSoloLive } from '../api/rooms';
import { clockText } from '../arena/hud/Hud';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { useModDialog } from './ModerationScreen';

// Moderación › Salas en vivo (multiplayer plan, phase 5): every open room with its code, kind, sector, state, players
// (connected or not) and how long since anything changed; a moderator closes one with a reason (audited), and its
// players are told.

const t = copy.admin.moderation;
const r = t.rooms;
const so = t.solo;
const probeName = (id: string) => DEFAULT_CONTENT.probes.find((p) => p.id === id)?.name ?? id;
const sectorName = (id: string) => DEFAULT_CONTENT.sectors.find((s) => s.id === id)?.name ?? id;

export function LiveRooms() {
  const rooms = useAdminRooms();
  const dialog = useModDialog();
  const rows = rooms.data?.rooms ?? [];
  return (
    <div className="mod-pane">
      <p className="panel-note">
        {r.live}
        {rooms.data ? `, ${r.count(rows.length)}` : ''}
      </p>
      {dialog.view}
      {rooms.error ? (
        <p className="field-error" role="alert">
          {errorText(rooms.error, copy.errors)}
        </p>
      ) : null}
      {rooms.data && rows.length === 0 ? <p className="panel-note">{r.none}</p> : null}
      {rows.length > 0 ? (
        <HScroll variant="table" className="admin-table-wrap">
          <table className="admin-table">
            <caption>{r.title}</caption>
            <thead>
              <tr>
                {(['code', 'kind', 'sector', 'state', 'members', 'idle', 'actions'] as const).map((c) => (
                  <th key={c} scope="col">
                    {r.cols[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((room) => (
                <tr key={room.code}>
                  <td className="lobby-code-text">{room.code}</td>
                  <td>{copy.coop.kinds[room.kind]}</td>
                  <td>{sectorName(room.sector)}</td>
                  <td>{r.states[room.state]}</td>
                  <td>
                    <ul className="admin-lobby-members">
                      {room.members.map((m) => (
                        <li key={m.username} className={m.connected ? undefined : 'away'}>
                          {m.leader ? <b>{r.member(m.username, m.level, m.connected)}</b> : r.member(m.username, m.level, m.connected)}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>{r.idle(room.idleSeconds)}</td>
                  <td className="admin-room-actions">
                    {room.run ? (
                      <Link className="lip pill small" to={`/admin/moderacion/directo/${room.run.id}`} aria-label={r.watchOf(room.code)}>
                        {r.watch}
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      className="lip pill small"
                      aria-haspopup="dialog"
                      aria-label={r.closeOf(room.code)}
                      onClick={() => dialog.start({ title: r.closeOf(room.code), submit: r.closeSubmit, url: `/admin/rooms/${room.code}/close` })}
                    >
                      {r.close}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScroll>
      ) : null}
      <SoloRuns />
    </div>
  );
}

/** Plan «escáner pro», part G: the solo runs being played now, each leading to its live view. */
function SoloRuns() {
  const solo = useAdminSoloLive();
  const rows = solo.data?.runs ?? [];
  return (
    <>
      {solo.error ? (
        <p className="field-error" role="alert">
          {errorText(solo.error, copy.errors)}
        </p>
      ) : null}
      {solo.data && rows.length === 0 ? <p className="panel-note">{so.none}</p> : null}
      {rows.length > 0 ? (
        <HScroll variant="table" className="admin-table-wrap">
          <table className="admin-table">
            <caption>{so.tableTitle}</caption>
            <thead>
              <tr>
                {(['player', 'sector', 'probe', 'time', 'state', 'watchers', 'actions'] as const).map((c) => (
                  <th key={c} scope="col">
                    {so.cols[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((run) => (
                <tr key={run.runId}>
                  <td>{run.player}</td>
                  <td>{sectorName(run.sector)}</td>
                  <td>{probeName(run.probe)}</td>
                  <td>{clockText(run.tick / 60)}</td>
                  <td>{so.states[run.state] ?? run.state}</td>
                  <td>{run.watchers}</td>
                  <td className="admin-room-actions">
                    <Link className="lip pill small" to={`/admin/moderacion/directo/solo/${run.runId}`} aria-label={so.watchOf(run.player)}>
                      {so.watch}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScroll>
      ) : null}
    </>
  );
}
