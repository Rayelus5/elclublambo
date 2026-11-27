import type { ReactNode } from 'react';
import { type HangarView, roomStartBlock, type RoomView } from '@galaxy/shared';
import { useLeaveRoom, useRoomAction, useRooms } from '../../api/rooms';
import { errorText } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { Icon } from '../../ui/Icon';
import type { Mode } from './Stage';
import { TodayButton } from './TodayConditions';

// The lobby's last step: Condiciones de hoy (the day's yield, the anomaly and the boosts in force, in a window) and the
// one big button. Alone it launches; in a group without a room it is Entrar rápido; in a room the leader launches once
// everyone is ready and the others say they are. Alone in a room (2026-11-17, the owner: a group room is not for
// playing solo) the leader cannot launch: one click leaves the room and plays solo.

const t = copy.coop;

function Big({ label, onClick, disabled, busy, tour, pressed }: { label: string; onClick: () => void; disabled: boolean; busy?: boolean; tour?: string; pressed?: boolean }) {
  return (
    <button
      type="button"
      className={`lip launch lobby-launch${pressed ? ' pressed' : ''}`}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-pressed={pressed}
      onClick={onClick}
      data-tour={tour}
      data-sfx="hover"
    >
      <span className="lobby-launch-shine" aria-hidden="true" />
      <Icon name={pressed === undefined ? 'play' : 'check'} />
      <span>{label}</span>
    </button>
  );
}

export function LaunchDock({
  view,
  mode,
  room,
  me,
  onLaunch,
  launching,
  error,
  notice,
  onSolo,
}: {
  view: HangarView;
  mode: Mode;
  room: RoomView | null;
  me: string;
  onLaunch: () => void;
  /** Back to solo mode (the room is left first). */
  onSolo: () => void;
  launching: boolean;
  error: unknown;
  /** Over the solo launch only: an admin's content draft about to be tried (admin debug mode, 2026-11-15). */
  notice?: ReactNode;
}) {
  const rooms = useRooms();
  const action = useRoomAction();
  const leave = useLeaveRoom();
  let cta;
  let hint: string | null = null;
  let solo = false;
  if (room) {
    const self = room.members.find((m) => m.username === me);
    if (room.leader === me) {
      cta = <Big label={t.start} disabled={!room.canStart || action.isPending} busy={action.isPending} onClick={() => action.mutate({ kind: 'start' })} tour="launch" />;
      solo = roomStartBlock(room.members) === 'alone';
      // Alone, only an admin may launch (the server says so with canStart; 2026-11-27).
      if (solo) hint = room.canStart ? t.aloneAdmin : t.needMate;
      else if (!room.canStart) hint = t.waitReady;
    } else {
      const ready = !!self?.ready;
      cta = <Big label={ready ? t.unready : t.markReady} pressed={ready} disabled={action.isPending || !self} onClick={() => action.mutate({ kind: 'ready', ready: !ready })} />;
    }
  } else if (mode === 'group') {
    cta = <Big label={t.quick} disabled={!rooms.data?.allowed || action.isPending} busy={action.isPending} onClick={() => action.mutate({ kind: 'quick' })} />;
    hint = t.quickHint;
  } else {
    cta = <Big label={copy.hangar.launch} disabled={!view.runsEnabled || launching} busy={launching} onClick={onLaunch} tour="launch" />;
  }
  return (
    <div className="lobby-dock">
      <TodayButton daily={view.daily} />
      {!view.runsEnabled ? <p className="field-error">{copy.errors.runs_disabled}</p> : null}
      {error ? <p className="field-error">{errorText(error, copy.errors)}</p> : null}
      {action.error ? (
        <p className="field-error" role="alert">
          {errorText(action.error, copy.errors)}
        </p>
      ) : null}
      {!room && mode === 'solo' ? notice : null}
      {cta}
      {hint ? <p className="lobby-hint lobby-dock-hint">{hint}</p> : null}
      {solo ? (
        <button type="button" className="lip pill small pill-terminal lobby-solo" disabled={leave.isPending} onClick={() => leave.mutate(undefined, { onSuccess: onSolo })}>
          <Icon name="probe" outline />
          <span>{t.playSolo}</span>
        </button>
      ) : null}
    </div>
  );
}
