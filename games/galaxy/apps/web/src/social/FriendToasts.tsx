import { useEffect } from 'react';
import { useFriendAction } from '../api/friends';
import { copy } from '../copy/es';
import { useLive, type LiveToast } from '../live/LiveConnection';
import { useUi } from '../state/ui';
import { Icon } from '../ui/Icon';

// What the live socket brings that a player should notice (plan phase 3): a friend request (accept it right there or
// open the friends) and an acceptance. Polite, bottom left, three at most, each gone after 9 seconds.

const t = copy.friends;
const LIFE_MS = 9000;

function Toast({ toast }: { toast: LiveToast }) {
  const dismiss = useLive((s) => s.dismiss);
  const openFriends = useUi((s) => s.openFriends);
  const action = useFriendAction();
  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), LIFE_MS);
    return () => clearTimeout(timer);
  }, [toast.id, dismiss]);
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
      <button type="button" className="lip iconbtn small" aria-label={t.dismiss} title={t.dismiss} onClick={() => dismiss(toast.id)}>
        <Icon name="close" />
      </button>
    </li>
  );
}

export function FriendToasts() {
  const toasts = useLive((s) => s.toasts);
  return (
    // A polite live region, not role=status: the screens keep their own status messages as the only one.
    <ul className="live-toasts" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} />
      ))}
    </ul>
  );
}
