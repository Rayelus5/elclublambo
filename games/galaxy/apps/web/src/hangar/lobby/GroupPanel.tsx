import type { HangarView, RoomKind, RoomView } from '@galaxy/shared';
import { type FormEvent, useId, useState } from 'react';
import { useFriends } from '../../api/friends';
import { useInvite, useLeaveRoom, useRoomAction, useRooms } from '../../api/rooms';
import { errorText } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { presenceText } from '../../social/FriendsPanel';
import { useUi } from '../../state/ui';
import { Icon } from '../../ui/Icon';
import { StepHead } from './WherePanel';

// Step 2 in a group (multiplayer plan, phase 5, now inside the lobby): without a room, make one (its kind and sector),
// enter one by its code, join a friend's, or pick a public one (Entrar rápido is the launch button). In a room: its
// code, the leader's sector and kind, inviting friends online, and leaving.

const t = copy.coop;
const KINDS: RoomKind[] = ['public', 'friends', 'private'];

export function GroupPanel({ view }: { view: HangarView }) {
  const rooms = useRooms();
  const friends = useFriends();
  const action = useRoomAction();
  const [kind, setKind] = useState<RoomKind>('public');
  const [sector, setSector] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const codeId = useId();
  const sectorId = useId();
  const v = rooms.data;
  const open = view.sectors.filter((s) => s.unlocked);
  const chosen = sector ?? view.sector ?? open[0]?.id ?? '';
  const nameOf = (id: string) => view.sectors.find((s) => s.id === id)?.name ?? id;
  const allowed = !!v?.allowed;
  const join = (c: string) => action.mutate({ kind: 'join', code: c });

  function submitCode(e: FormEvent): void {
    e.preventDefault();
    if (code.trim()) join(code.trim());
  }

  const online = (friends.data?.friends ?? []).filter((f) => f.presence.status === 'online');
  return (
    <div className="lobby-group">
      <StepHead n={2}>{t.title}</StepHead>
      {v && !v.allowed ? (
        <p className="lobby-note" role="status">
          <Icon name="lock" />
          <span>
            {v.reason === 'tutorial'
              ? t.lockedTutorial
              : v.reason === 'level'
                ? t.lockedLevel(v.minLevel)
                : v.reason === 'abandons'
                  ? t.lockedAbandons(v.waitUntil)
                  : t.lockedOff}
          </span>
        </p>
      ) : null}
      {action.isError ? (
        <p className="field-error" role="alert">
          {errorText(action.error, copy.errors)}
        </p>
      ) : null}

      <section className="lobby-block" aria-labelledby="lobby-create">
        <h3 id="lobby-create">{t.createTitle}</h3>
        <div className="segmented lobby-kinds" role="radiogroup" aria-label={t.kindLabel}>
          {KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>
              {t.kinds[k]}
            </button>
          ))}
        </div>
        <p className="lobby-hint">{t.kindHint[kind]}</p>
        <div className="lobby-create-row">
          <label htmlFor={sectorId} className="sr-only">
            {t.sector}
          </label>
          <select id={sectorId} value={chosen} onChange={(e) => setSector(e.target.value)}>
            {open.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" className="lip pill pill-solar small" disabled={!allowed || !chosen || action.isPending} onClick={() => action.mutate({ kind: 'create', room: kind, sector: chosen })}>
            <Icon name="plus" />
            <span>{t.create}</span>
          </button>
        </div>
      </section>

      <section className="lobby-block" aria-labelledby="lobby-code">
        <h3 id="lobby-code">{t.codeTitle}</h3>
        <form className="lobby-code-form" onSubmit={submitCode}>
          <label htmlFor={codeId} className="sr-only">
            {t.codeLabel}
          </label>
          <input id={codeId} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC234" maxLength={6} autoComplete="off" spellCheck={false} />
          <button type="submit" className="lip pill small" disabled={!allowed || code.trim().length !== 6 || action.isPending}>
            {t.join}
          </button>
        </form>
      </section>

      <section className="lobby-block" aria-labelledby="lobby-friends">
        <h3 id="lobby-friends">{t.friendsTitle}</h3>
        {online.length === 0 ? (
          <p className="lobby-hint">{t.noFriends}</p>
        ) : (
          <ul className="lobby-people">
            {online.map((f) => {
              const roomCode = f.presence.status === 'online' ? f.presence.room?.code : undefined;
              return (
                <li key={f.username}>
                  <span className="friend-dot on" aria-hidden="true" />
                  <span className="lobby-person">
                    <b>{f.username}</b>
                    <small>{presenceText(f.presence)}</small>
                  </span>
                  {roomCode ? (
                    <button type="button" className="lip pill small pill-solar" disabled={!allowed || action.isPending} onClick={() => join(roomCode)}>
                      {t.joinFriend}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="lobby-block" aria-labelledby="lobby-public">
        <h3 id="lobby-public">{t.publicTitle}</h3>
        {!v ? (
          <p className="lobby-hint" aria-hidden="true">
            ⠋⠙⠹
          </p>
        ) : v.open.length === 0 ? (
          <p className="lobby-hint">{t.noRooms}</p>
        ) : (
          <ul className="lobby-people">
            {v.open.map((r) => (
              <li key={r.code}>
                <span className="lobby-person">
                  <b>{nameOf(r.sector)}</b>
                  <small>
                    {t.ledBy(r.leader)}, {t.levels(r.levels[0], r.levels[1]).toLowerCase()}
                  </small>
                </span>
                <span className="lobby-size" aria-label={t.size(r.size, r.max)}>
                  {Array.from({ length: r.max }, (_, k) => (
                    <i key={k} className={k < r.size ? 'on' : undefined} />
                  ))}
                </span>
                <button type="button" className="lip pill small" disabled={!allowed || action.isPending} onClick={() => join(r.code)}>
                  {t.join}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function RoomPanel({ view, room, me }: { view: HangarView; room: RoomView; me: string }) {
  const openChat = useUi((s) => s.openChat);
  const friends = useFriends();
  const action = useRoomAction();
  const leave = useLeaveRoom();
  const invite = useInvite();
  const [copied, setCopied] = useState(false);
  const [invited, setInvited] = useState<string[]>([]);
  const lead = room.leader === me;
  const busy = action.isPending || leave.isPending;
  const inRoom = new Set(room.members.map((m) => m.username));
  const online = (friends.data?.friends ?? []).filter((f) => f.presence.status === 'online' && !inRoom.has(f.username));
  const sectorName = view.sectors.find((s) => s.id === room.sector)?.name ?? room.sector;

  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="lobby-group">
      <div className="lobby-room-head">
        <StepHead n={2}>{t.roomTitle}</StepHead>
        <button type="button" className="lip pill small lobby-leave" disabled={busy} onClick={() => leave.mutate()}>
          <Icon name="exit" />
          <span>{t.leave}</span>
        </button>
      </div>
      <button type="button" className="lip pill small lobby-room-chat" onClick={() => openChat('room')} aria-haspopup="dialog">
        <Icon name="chat" />
        <span>{copy.chat.openRoom}</span>
      </button>
      <button type="button" className="lip lobby-room-code" onClick={() => void copyCode()} aria-label={t.copyCode(room.code)}>
        <span className="lobby-room-code-text">{room.code}</span>
        <Icon name="copy" />
        <span role="status" className="lobby-room-copied">
          {copied ? t.copied : ''}
        </span>
      </button>
      {action.isError || leave.isError || invite.isError ? (
        <p className="field-error" role="alert">
          {errorText(action.error ?? leave.error ?? invite.error, copy.errors)}
        </p>
      ) : null}
      <dl className="lobby-room-settings">
        <div>
          <dt>{t.sector}</dt>
          <dd>
            {lead ? (
              <select aria-label={t.sector} value={room.sector} disabled={busy} onChange={(e) => action.mutate({ kind: 'sector', sector: e.target.value })}>
                {view.sectors
                  .filter((s) => s.unlocked)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            ) : (
              <b>{sectorName}</b>
            )}
          </dd>
        </div>
        <div>
          <dt>{t.kindLabel}</dt>
          <dd>
            {lead ? (
              <div className="segmented lobby-kinds" role="radiogroup" aria-label={t.kindLabel}>
                {KINDS.map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={room.kind === k} disabled={busy} onClick={() => action.mutate({ kind: 'type', room: k })}>
                    {t.kinds[k]}
                  </button>
                ))}
              </div>
            ) : (
              <b>{t.kinds[room.kind]}</b>
            )}
          </dd>
        </div>
      </dl>

      <section className="lobby-block" aria-labelledby="lobby-invite">
        <h3 id="lobby-invite">{t.inviteTitle}</h3>
        <p className="lobby-hint">{t.inviteHint}</p>
        {online.length === 0 ? (
          <p className="lobby-hint">{t.noFriends}</p>
        ) : (
          <ul className="lobby-people">
            {online.map((f) => (
              <li key={f.username}>
                <span className="friend-dot on" aria-hidden="true" />
                <span className="lobby-person">
                  <b>{f.username}</b>
                  <small>{invited.includes(f.username) ? t.invited : copy.social.level(f.level)}</small>
                </span>
                <button
                  type="button"
                  className="lip pill small"
                  disabled={invite.isPending || room.members.length >= room.max || invited.includes(f.username)}
                  onClick={() => invite.mutate(f.username, { onSuccess: () => setInvited((xs) => [...xs, f.username]) })}
                >
                  {t.invite}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

    </div>
  );
}
