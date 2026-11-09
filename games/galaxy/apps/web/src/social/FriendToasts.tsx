import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useFriendAction } from '../api/friends';
import { useRoomAction } from '../api/rooms';
import { useHangar } from '../api/runs';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { useLive, type LiveToast } from '../live/LiveConnection';
import { useUi } from '../state/ui';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { ResultsScreen } from '../hangar/ResultsScreen';

// What the live socket brings that a player should notice (plan phases 3, 5 and 6c): a friend request (accept it
// right there or open the friends), an acceptance, an invite to a room (join it right there), being taken out of my
// room, and the result of a group run I had left (its results open in a window).
// Polite, bottom left, three at most, each gone after 9 seconds; none during a run.

const t = copy.friends;
const LIFE_MS = 9000;
const RESULT_LIFE_MS = 30_000;

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
    // A result waits longer than a passing notice.
    const timer = setTimeout(() => dismiss(toast.id), toast.kind === 'coopResult' ? RESULT_LIFE_MS : LIFE_MS);
    return () => clearTimeout(timer);
  }, [toast.id, toast.kind, dismiss]);
  const close = (
    <button type="button" className="lip iconbtn small" aria-label={t.dismiss} title={t.dismiss} onClick={() => dismiss(toast.id)}>
      <Icon name="close" />
    </button>
  );
  if (toast.kind === 'coopResult') {
    return (
      <li className="lip panel live-toast">
        <Icon name="trophy" />
        <span>{copy.coop.resultToast}</span>
        <button
          type="button"
          className="lip pill pill-solar small"
          onClick={() => {
            useLive.setState({ shownResult: toast.result });
            dismiss(toast.id);
          }}
        >
          {copy.coop.resultSee}
        </button>
        {close}
      </li>
    );
  }
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
                  void navigate('/incursion');
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
  const shown = useLive((s) => s.shownResult);
  const closeResult = () => useLive.setState({ shownResult: null });
  return (
    <>
      {/* A polite live region, not role=status: the screens keep their own status messages as the only one. */}
      <ul className="live-toasts" aria-live="polite" aria-relevant="additions">
        {running
          ? null
          : toasts.map((toast) => (
              <Toast key={toast.id} toast={toast} />
            ))}
      </ul>
      {/* The result of a group run I had left (phase 6c), opened from its notice. */}
      {shown && !running ? (
        <Dialog title={copy.coop.resultTitle} hideTitle onClose={closeResult} className="coop-result-dialog">
          <ResultsScreen result={shown} onAgain={closeResult} />
        </Dialog>
      ) : null}
    </>
  );
}
