import { useFriendAction } from '../api/friends';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';

const t = copy.friends;

/**
 * Blocking someone, always asked first (the owner, 2026-11-14: «si dos personas son amigas y una le da a bloquear sin
 * querer, se elimina de amigo aunque no lo parezca»). It says what a block does, and that a friend stops being one.
 * Cancelar has the focus; Bloquear is red.
 */
export function BlockConfirm({ username, friend, onClose, onDone }: { username: string; friend: boolean; onClose: () => void; onDone?: () => void }) {
  const action = useFriendAction();
  return (
    <Dialog role="alertdialog" title={t.blockTitle(username)} onClose={onClose} className="confirm">
      <p>{friend ? t.blockBody : t.blockBodyStranger}</p>
      {action.isError ? (
        <p className="field-error" role="alert">
          {errorText(action.error, copy.errors)}
        </p>
      ) : null}
      <div className="confirm-actions">
        <button type="button" className="lip pill" data-autofocus onClick={onClose}>
          {t.keep}
        </button>
        <button
          type="button"
          className="lip pill danger"
          disabled={action.isPending}
          onClick={() =>
            action.mutate(
              { username, action: 'block' },
              {
                onSuccess: () => {
                  onDone?.();
                  onClose();
                },
              },
            )
          }
        >
          {t.block}
        </button>
      </div>
    </Dialog>
  );
}
