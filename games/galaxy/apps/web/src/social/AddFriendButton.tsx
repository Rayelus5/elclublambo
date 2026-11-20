import { useFriendAction, useFriends } from '../api/friends';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';
import { relationOf } from './relation';

// «Añadir amigo» next to another player (Nov plan A3): in the room's cards and the team results. It reads the
// relation from the cached friends view; the action's answer replaces it, so the button follows at once. Nothing
// for a friend or a blocked player; accepting is offered when they asked first.
const t = copy.friends.profile;

/** `compact`: a round icon button (its name as its label and tooltip), for a row already full of buttons. */
export function AddFriendButton({ username, className = '', compact = false }: { username: string; className?: string; compact?: boolean }) {
  const friends = useFriends();
  const action = useFriendAction();
  const relation = relationOf(friends.data, username);
  // Until my list is in, nothing (a friend would flash «Añadir amigo»); without friends (switched off), nothing either.
  if (!friends.data || relation === 'friends' || relation === 'blocked') return null;
  const busy = action.isPending;
  return (
    <span className={`add-friend ${className}`.trim()}>
      {compact ? (
        <button
          type="button"
          className={`lip iconbtn add-friend-icon${relation === 'outgoing' ? '' : ' pill-terminal'}`}
          disabled={busy || relation === 'outgoing'}
          aria-label={relation === 'outgoing' ? t.sent : relation === 'incoming' ? t.accept : t.add}
          title={relation === 'outgoing' ? t.sent : relation === 'incoming' ? t.accept : t.add}
          onClick={() => action.mutate({ username, action: relation === 'incoming' ? 'accept' : 'request' })}
        >
          <Icon name={relation === 'outgoing' ? 'check' : 'addFriend'} />
        </button>
      ) : relation === 'outgoing' ? (
        <button type="button" className="lip pill small" disabled>
          {t.sent}
        </button>
      ) : (
        <button type="button" className="lip pill small pill-terminal" disabled={busy} onClick={() => action.mutate({ username, action: relation === 'incoming' ? 'accept' : 'request' })}>
          <Icon name="addFriend" />
          <span>{relation === 'incoming' ? t.accept : t.add}</span>
        </button>
      )}
      {action.error ? (
        <small className="add-friend-error" role="alert">
          {errorText(action.error, copy.errors)}
        </small>
      ) : null}
    </span>
  );
}
