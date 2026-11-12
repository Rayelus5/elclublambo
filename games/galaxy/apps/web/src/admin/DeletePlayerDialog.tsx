import { copy } from '../copy/es';
import { ActionDialog } from './ActionDialog';

// «Eliminar» (plan «escáner pro», part F; the owner chose «anonimizar y cerrar»): the account stays as an anonymous,
// closed placeholder so its history holds, and its personal and social data go. It cannot be undone, so it asks for
// the reason, the admin's password and the name typed again; «Reservar el nombre» keeps it off new accounts.

const t = copy.admin;

export function DeletePlayerDialog({ username, onDone, onClose }: { username: string; onDone: (anon: string) => void; onClose: () => void }) {
  return (
    <ActionDialog
      url={`/admin/players/${encodeURIComponent(username)}/delete`}
      title={t.actions.deleteOf(username)}
      submit={t.actions.delete}
      intro={<p className="admin-warn">{t.deleteIntro}</p>}
      fields={[
        { name: 'confirm', label: t.fields.confirm, kind: 'text', hint: t.fields.confirmHint(username) },
        { name: 'reserveName', label: t.fields.reserveName, kind: 'switch', hint: t.fields.reserveNameHint },
      ]}
      password={() => true}
      valid={(v) => v['confirm']!.trim().toLowerCase() === username.toLowerCase()}
      build={(v) => ({ confirm: v['confirm']!.trim(), reserveName: v['reserveName'] === '1' })}
      onResult={(r) => onDone(String(r['username']))}
      onDone={() => {}}
      onClose={onClose}
    />
  );
}
