import type { RoomKind } from '@galaxy/shared';
import { type FormEvent, useId, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useFriends } from '../api/friends';
import { useRoomAction, useRooms } from '../api/rooms';
import { useHangar } from '../api/runs';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { presenceText } from '../social/FriendsPanel';
import { BackLink } from '../ui/BackLink';
import { Icon } from '../ui/Icon';

// Playing in a group (multiplayer plan, phase 5): make a room (public, friends-only or private, and its sector among
// the ones I have unlocked), enter one by its code, take Entrar rápido, or pick one from the public list; on the right,
// my friends online, with Unirse when they are in a room I may join. Once in a room, its page.

const t = copy.coop;
const KINDS: RoomKind[] = ['public', 'friends', 'private'];

export function GroupScreen() {
  const rooms = useRooms();
  const hangar = useHangar();
  const friends = useFriends();
  const action = useRoomAction();
  const navigate = useNavigate();
  const [kind, setKind] = useState<RoomKind>('public');
  const [sector, setSector] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const codeId = useId();
  const sectorId = useId();
  const v = rooms.data;
  if (v?.mine) return <Navigate to="/incursion/sala" replace />;
  const open = hangar.data?.sectors.filter((s) => s.unlocked) ?? [];
  const chosen = sector ?? hangar.data?.sector ?? open[0]?.id ?? '';
  const nameOf = (id: string) => hangar.data?.sectors.find((s) => s.id === id)?.name ?? id;
  const go = () => navigate('/incursion/sala');
  const join = (c: string) => action.mutate({ kind: 'join', code: c }, { onSuccess: go });

  function submitCode(e: FormEvent): void {
    e.preventDefault();
    if (code.trim()) join(code.trim());
  }

  const online = (friends.data?.friends ?? []).filter((f) => f.presence.status === 'online');
  return (
    <div className="screen-root coop-root">
      <div className="coop">
        <header className="collection-bar">
          <BackLink to="/incursion" />
          <h1>{t.title}</h1>
        </header>
        {v && !v.allowed ? (
          <p className="lip panel coop-locked" role="status">
            <Icon name="lock" />
            <span>{v.reason === 'tutorial' ? t.lockedTutorial : v.reason === 'level' ? t.lockedLevel(v.minLevel) : t.lockedOff}</span>
          </p>
        ) : null}
        {action.isError ? (
          <p className="summary error" role="alert">
            <Icon name="alert" />
            <span>{errorText(action.error, copy.errors)}</span>
          </p>
        ) : null}
        <div className="coop-grid">
          <section className="lip panel coop-start" aria-label={t.startTitle}>
            <h2>{t.startTitle}</h2>
            <button type="button" className="lip launch coop-quick" disabled={!v?.allowed || action.isPending} onClick={() => action.mutate({ kind: 'quick' }, { onSuccess: go })} data-sfx="hover">
              <Icon name="play" />
              <span>{t.quick}</span>
            </button>
            <p className="coop-hint">{t.quickHint}</p>
            <h3>{t.createTitle}</h3>
            <div className="segmented coop-kinds" role="radiogroup" aria-label={t.kindLabel}>
              {KINDS.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>
                  {t.kinds[k]}
                </button>
              ))}
            </div>
            <p className="coop-hint">{t.kindHint[kind]}</p>
            <label htmlFor={sectorId} className="coop-label">
              {t.sector}
            </label>
            <select id={sectorId} value={chosen} onChange={(e) => setSector(e.target.value)}>
              {open.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button type="button" className="lip pill pill-solar" disabled={!v?.allowed || !chosen || action.isPending} onClick={() => action.mutate({ kind: 'create', room: kind, sector: chosen }, { onSuccess: go })}>
              <Icon name="plus" />
              <span>{t.create}</span>
            </button>
            <h3>{t.codeTitle}</h3>
            <form className="coop-code" onSubmit={submitCode}>
              <label htmlFor={codeId} className="sr-only">
                {t.codeLabel}
              </label>
              <input id={codeId} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC234" maxLength={6} autoComplete="off" spellCheck={false} />
              <button type="submit" className="lip pill" disabled={!v?.allowed || code.trim().length !== 6 || action.isPending}>
                {t.join}
              </button>
            </form>
          </section>

          <section className="lip panel coop-list" aria-label={t.publicTitle}>
            <h2>{t.publicTitle}</h2>
            {!v ? (
              <p className="coop-hint" aria-hidden="true">
                ⠋⠙⠹
              </p>
            ) : v.open.length === 0 ? (
              <p className="coop-empty">{t.noRooms}</p>
            ) : (
              <ul>
                {v.open.map((r) => (
                  <li key={r.code} className="coop-room">
                    <div>
                      <b>{nameOf(r.sector)}</b>
                      <span>{t.ledBy(r.leader)}</span>
                      <span>{t.levels(r.levels[0], r.levels[1])}</span>
                    </div>
                    <span className="coop-size" aria-label={t.size(r.size, r.max)}>
                      {Array.from({ length: r.max }, (_, k) => (
                        <i key={k} className={k < r.size ? 'on' : undefined} />
                      ))}
                    </span>
                    <button type="button" className="lip pill small" disabled={!v.allowed || action.isPending} onClick={() => join(r.code)}>
                      {t.join}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside className="lip panel coop-friends" aria-label={t.friendsTitle}>
            <h2>{t.friendsTitle}</h2>
            {online.length === 0 ? (
              <p className="coop-empty">{t.noFriends}</p>
            ) : (
              <ul>
                {online.map((f) => {
                  const roomCode = f.presence.status === 'online' ? f.presence.room?.code : undefined;
                  return (
                    <li key={f.username} className="coop-friend">
                      <span className="friend-dot on" aria-hidden="true" />
                      <div>
                        <b>{f.username}</b>
                        <span>{presenceText(f.presence)}</span>
                      </div>
                      {roomCode ? (
                        <button type="button" className="lip pill small pill-solar" disabled={!v?.allowed || action.isPending} onClick={() => join(roomCode)}>
                          {t.joinFriend}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
