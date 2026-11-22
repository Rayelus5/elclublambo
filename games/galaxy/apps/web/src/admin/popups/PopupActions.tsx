import { type AdminPopup, POPUP_ANSWER_GRACE_MS } from '@galaxy/shared';
import { ActionDialog } from '../ActionDialog';
import { t } from './shared';

// What can be done to a campaign that cannot be undone (plan 2026-11-22, part A): delete a draft (with a reason), take a
// scheduled one back to draft or end one now (with a reason and the admin's password), in the panel's own dialog.
// Ending it leaves a grace for whoever has it open; the dialog says how long.

export type PopupAction = { kind: 'remove' | 'unpublish' | 'end'; popup: AdminPopup };

const GRACE_MINUTES = Math.round(POPUP_ANSWER_GRACE_MS / 60_000);

export function PopupActionDialog({ action, onClose }: { action: PopupAction; onClose: (done?: string) => void }) {
  const x = action.popup;
  const title = x.record.title;
  const common = { onClose: () => onClose() };
  if (action.kind === 'remove')
    return (
      <ActionDialog
        {...common}
        url={`/admin/popups/${x.id}/delete`}
        title={t.removeTitle(title)}
        submit={t.actions.remove}
        intro={<p>{t.removeText}</p>}
        password={() => false}
        onDone={() => onClose(t.done.removed(title))}
      />
    );
  if (action.kind === 'unpublish')
    return (
      <ActionDialog
        {...common}
        url={`/admin/popups/${x.id}/unpublish`}
        title={t.unpublishTitle(title)}
        submit={t.actions.unpublish}
        intro={<p>{t.unpublishText}</p>}
        password={() => true}
        onDone={() => onClose(t.done.unpublished(title))}
      />
    );
  return (
    <ActionDialog
      {...common}
      url={`/admin/popups/${x.id}/end`}
      title={t.endTitle(title)}
      submit={t.actions.end}
      intro={<p>{t.endText(GRACE_MINUTES)}</p>}
      password={() => true}
      onDone={() => onClose(t.done.ended(title))}
    />
  );
}
