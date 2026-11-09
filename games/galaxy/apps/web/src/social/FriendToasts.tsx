import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useFriendAction } from '../api/friends';
import { useRoomAction } from '../api/rooms';
import { useHangar } from '../api/runs';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { useLive, type LiveToast } from '../live/LiveConnection';
import { useUi } from '../state/ui';
import { Icon } from '../ui/Icon';

// What the live socket brings that a player should notice (plan phases 3 and 5): a friend request (accept it right
// there or open the friends), an acceptance, an invite to a room (join it right there) and being taken out of my room.
// Polite, bottom left, three at most, each gone after 9 seconds; none during a run.

const t = copy.friends;
const LIFE_MS = 9000;

function InviteText({ from, sector }: { from: string; sector: string }) {
  const name = useHangar().data?.sectors.find((s) => s.id === sector)?.name ?? sector;
  return <span>{copy.coop.toastInvite(from, name)}</span>;
}

function Toast({ toast }: { toast: LiveToast }) {
  const dismiss = useLive((s) => s.dismiss);
  const openFriends = useUi((s) => s.openFriends);
  const action = useFriendAction();
  const room = useRoomAction();
  const navigate = useNavigate();
  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), LIFE_MS);
    return () => clearTimeout(timer);
  }, [toast.id, dismiss]);
  const close = (
    <button type="button" className="lip iconbtn small" aria-label={t.dismiss} title={t.dismiss} onClick={() => dismiss(toast.id)}>
      <Icon name="close" />
    </button>
  );
  if (toast.kind === 'kicked' || toast.kind === 'closed') {
    return (
      <li className="lip panel live-toast">
        <Icon name="alert" />
        <span>{toast.kind === 'kicked' ? copy.coop.kicked : copy.coop.closed}</span>
        {close}
      </li>
    );
  }
  if (toast.kind === 'invite') {
    return (
      <li className="lip panel live-toast">
        <Icon name="play" />
        <InviteText from={toast.username} sector={toast.invite.sector} />
        <button
          type="button"
          className="lip pill pill-solar small"
          disabled={room.isPending}
          onClick={() =>
            room.mutate(
              { kind: 'join', code: toast.invite.code },
              {
                onSuccess: () => {
                  dismiss(toast.id);
                  void navigate('/incursion/sala');
                },
              },
            )
          }
        >
          {copy.coop.accept}
        </button>
        {room.isError ? <span className="live-toast-error">{errorText(room.error, copy.errors)}</span> : null}
        {close}
      </li>
    );
  }
  return (
    <li className="lip panel live-toast">
      <Icon name="clan" />
      <span>{toast.kind === 'request' ? t.toastRequest(toast.username) : t.toastAccepted(toast.username)}</span>
      {toast.kind === 'request' ? (
        <button
          type="button"
          className="lip pill pill-solar small"
          disabled={action.isPending}
          onClick={() => action.mutate({ username: toast.username, action: 'accept' }, { onSuccess: () => dismiss(toast.id) })}
        >
          {t.accept}
        </button>
      ) : null}
      <button
        type="button"
        className="lip pill small"
        onClick={() => {
          openFriends();
          dismiss(toast.id);
        }}
      >
        {t.see}
      </button>
      {close}
    </li>
  );
}

export function FriendToasts() {
  const toasts = useLive((s) => s.toasts);
  const running = useLive((s) => s.run !== null);
  return (
    // A polite live region, not role=status: the screens keep their own status messages as the only one.
    <ul className="live-toasts" aria-live="polite" aria-relevant="additions">
      {running
        ? null
        : toasts.map((toast) => (
            <Toast key={toast.id} toast={toast} />
          ))}
    </ul>
  );
}
