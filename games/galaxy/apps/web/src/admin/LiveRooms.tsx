import { HScroll } from '../ui/HScroll';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { Link } from 'react-router';
import { useAdminRooms } from '../api/rooms';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { useModDialog } from './ModerationScreen';

// Moderación › Salas en vivo (multiplayer plan, phase 5): every open room with its code, kind, sector, state, players
// (connected or not) and how long since anything changed; a moderator closes one with a reason (audited), and its
// players are told.

const t = copy.admin.moderation;
const r = t.rooms;
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
    </div>
  );
}
