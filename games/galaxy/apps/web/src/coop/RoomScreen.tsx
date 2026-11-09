import type { RoomKind, RoomMember } from '@galaxy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useFriends } from '../api/friends';
import { ROOMS_KEY, useInvite, useLeaveRoom, useRoomAction, useRooms } from '../api/rooms';
import { useHangar } from '../api/runs';
import { errorText, useMe } from '../auth/useMe';
import { spriteDataUrl } from '../arena/sprites';
import { copy } from '../copy/es';
import { Avatar } from '../hub/Avatar';
import { BackLink } from '../ui/BackLink';
import { Icon } from '../ui/Icon';
import { CoopArena } from './CoopArena';

// My room (multiplayer plan, phase 5): four places with each player's probe, level, «listo» and whether they are
// connected; the leader picks the sector and the kind, kicks, hands the lead over and launches when everyone is ready.
// Everyone marks ready, changes their own probe and relics in the hangar, invites friends online and leaves. The
// code (and the link) bring friends in. While the room plays its run (phase 6) the page is the run, and it stays on
// its results until the player goes back to the room.

const t = copy.coop;
const KINDS: RoomKind[] = ['public', 'friends', 'private'];

function Slot({ m, leaderView, me, onKick, onLead, busy, probeOf }: { m: RoomMember | null; leaderView: boolean; me: string; onKick: (u: string) => void; onLead: (u: string) => void; busy: boolean; probeOf: (id: string) => { sprite: string; name: string } }) {
  if (!m) {
    return (
      <li className="lobby-slot empty">
        <span className="lobby-empty-ring" aria-hidden="true" />
        <span>{t.waiting}</span>
      </li>
    );
  }
  const probe = probeOf(m.probe);
  const url = spriteDataUrl(probe.sprite, 4);
  return (
    <li className={`lobby-slot${m.ready ? ' ready' : ''}${m.connected ? '' : ' away'}`}>
      {m.leader ? (
        <span className="lobby-crown" role="img" aria-label={t.leader}>
          <Icon name="trophy" />
        </span>
      ) : null}
      <span className="lobby-avatar">
        <Avatar name={m.username} />
      </span>
      <b>{m.username}</b>
      <span className="lobby-level">{copy.social.level(m.level)}</span>
      {url ? <img className="lobby-probe" src={url} alt={t.flies(probe.name)} /> : null}
      <span className={`lobby-ready${m.ready || m.leader ? ' on' : ''}`}>{m.leader ? t.leads : m.ready ? t.ready : t.notReady}</span>
      {!m.connected ? <span className="lobby-away">{t.disconnected}</span> : null}
      {leaderView && m.username !== me ? (
        <span className="lobby-slot-actions">
          <button type="button" className="lip pill small" disabled={busy} onClick={() => onLead(m.username)}>
            {t.makeLeader}
          </button>
          <button type="button" className="lip pill small danger" disabled={busy} onClick={() => onKick(m.username)}>
            {t.kick}
          </button>
        </span>
      ) : null}
    </li>
  );
}

export function RoomScreen() {
  const rooms = useRooms();
  const me = useMe().data?.username ?? '';
  const hangar = useHangar();
  const friends = useFriends();
  const action = useRoomAction();
  const leave = useLeaveRoom();
  const invite = useInvite();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [invited, setInvited] = useState<string | null>(null);
  const qc = useQueryClient();
  const room = rooms.data?.mine;
  // The run on screen: the room's while it plays, and after it until its results are closed.
  const [playing, setPlaying] = useState<string | null>(null);
  const [finished, setFinished] = useState<string | null>(null);
  const runId = room?.run?.id ?? null;
  if (runId && runId !== playing && runId !== finished) setPlaying(runId);
  if (playing) {
    return (
      <CoopArena
        key={playing}
        runId={playing}
        onExit={() => {
          setFinished(playing);
          setPlaying(null);
          void qc.invalidateQueries({ queryKey: ROOMS_KEY });
        }}
        onAbandon={() => {
          setFinished(playing);
          setPlaying(null);
          leave.mutate(undefined, { onSuccess: () => navigate('/incursion/grupo') });
        }}
      />
    );
  }
  if (rooms.data && !room) return <Navigate to="/incursion/grupo" replace />;
  if (!room) return null;
  const leaderView = room.leader === me;
  const mine = room.members.find((m) => m.username === me);
  const sectorName = (id: string) => hangar.data?.sectors.find((s) => s.id === id)?.name ?? id;
  const probeOf = (id: string) => hangar.data?.probes.find((p) => p.id === id) ?? { sprite: 'probe-lumen', name: id };
  const slots = Array.from({ length: room.max }, (_, k) => room.members[k] ?? null);
  const inRoom = new Set(room.members.map((m) => m.username));
  const online = (friends.data?.friends ?? []).filter((f) => f.presence.status === 'online' && !inRoom.has(f.username));
  const busy = action.isPending || leave.isPending;

  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(room!.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="screen-root coop-root">
      <div className="coop lobby">
        <header className="collection-bar">
          <BackLink fallback="/incursion">
            <Icon name="back" />
            <span>{t.back}</span>
          </BackLink>
          <h1>{t.roomTitle}</h1>
          <button type="button" className="lip pill lobby-code" onClick={() => void copyCode()} aria-label={t.copyCode(room.code)}>
            <Icon name="copy" />
            <span className="lobby-code-text">{room.code}</span>
            <span role="status">{copied ? t.copied : ''}</span>
          </button>
        </header>
        {action.isError || leave.isError || invite.isError ? (
          <p className="summary error" role="alert">
            <Icon name="alert" />
            <span>{errorText(action.error ?? leave.error ?? invite.error, copy.errors)}</span>
          </p>
        ) : null}
        <div className="lobby-grid">
          <section className="lip panel lobby-main" aria-label={t.playersTitle}>
            <div className="lobby-settings">
              <div>
                <span className="coop-label">{t.sector}</span>
                {leaderView ? (
                  <select aria-label={t.sector} value={room.sector} disabled={busy} onChange={(e) => action.mutate({ kind: 'sector', sector: e.target.value })}>
                    {(hangar.data?.sectors.filter((s) => s.unlocked) ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <b>{sectorName(room.sector)}</b>
                )}
              </div>
              <div>
                <span className="coop-label">{t.kindLabel}</span>
                {leaderView ? (
                  <div className="segmented" role="radiogroup" aria-label={t.kindLabel}>
                    {KINDS.map((k) => (
                      <button key={k} type="button" role="radio" aria-checked={room.kind === k} disabled={busy} onClick={() => action.mutate({ kind: 'type', room: k })}>
                        {t.kinds[k]}
                      </button>
                    ))}
                  </div>
                ) : (
                  <b>{t.kinds[room.kind]}</b>
                )}
              </div>
            </div>
            <ul className="lobby-slots">
              {slots.map((m, k) => (
                <Slot key={m?.username ?? `empty-${k}`} m={m} leaderView={leaderView} me={me} busy={busy} probeOf={probeOf} onKick={(u) => action.mutate({ kind: 'kick', username: u })} onLead={(u) => action.mutate({ kind: 'lead', username: u })} />
              ))}
            </ul>
            <div className="lobby-actions">
              <button type="button" className="lip pill" disabled={busy} onClick={() => leave.mutate(undefined, { onSuccess: () => navigate('/incursion/grupo') })}>
                <Icon name="exit" />
                <span>{t.leave}</span>
              </button>
              <Link to="/incursion" className="lip pill">
                <Icon name="probe" />
                <span>{t.loadout}</span>
              </Link>
              {!leaderView && mine ? (
                <button type="button" className={`lip pill${mine.ready ? '' : ' pill-solar'}`} aria-pressed={mine.ready} disabled={busy} onClick={() => action.mutate({ kind: 'ready', ready: !mine.ready })}>
                  <Icon name="check" />
                  <span>{mine.ready ? t.unready : t.markReady}</span>
                </button>
              ) : null}
              {leaderView ? (
                <button type="button" className="lip launch lobby-start" disabled={!room.canStart || busy} onClick={() => action.mutate({ kind: 'start' })}>
                  <Icon name="play" />
                  <span>{t.start}</span>
                </button>
              ) : null}
            </div>
            {leaderView && !room.canStart ? <p className="coop-hint">{t.waitReady}</p> : null}
          </section>

          <aside className="lip panel coop-friends" aria-label={t.inviteTitle}>
            <h2>{t.inviteTitle}</h2>
            <p className="coop-hint">{t.inviteHint}</p>
            {online.length === 0 ? (
              <p className="coop-empty">{t.noFriends}</p>
            ) : (
              <ul>
                {online.map((f) => (
                  <li key={f.username} className="coop-friend">
                    <span className="friend-dot on" aria-hidden="true" />
                    <div>
                      <b>{f.username}</b>
                      <span>{invited === f.username ? t.invited : copy.social.level(f.level)}</span>
                    </div>
                    <button
                      type="button"
                      className="lip pill small"
                      disabled={invite.isPending || room.members.length >= room.max}
                      onClick={() => invite.mutate(f.username, { onSuccess: () => setInvited(f.username) })}
                    >
                      {t.invite}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
