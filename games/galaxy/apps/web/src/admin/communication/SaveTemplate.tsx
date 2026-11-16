import { type MailTemplate, parseConfig } from '@galaxy/shared';
import { useId, useState } from 'react';
import { type ConfigKeyRow, usePublishConfig } from '../../api/config';
import { errorText } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { uniqueSlug } from '../../gifts/slug';
import { Dialog } from '../../ui/Dialog';

// Saving what is being written as a template of the mail library (mail v2, P5): its kind, text and gifts under a name,
// published as the `mail` key with its version (another admin's publish in between answers config_conflict), a reason
// and the password.

const t = copy.admin.communication;

export function SaveTemplate({ row, draft, onClose, onSaved }: { row: ConfigKeyRow; draft: Omit<MailTemplate, 'id' | 'name'>; onClose: () => void; onSaved: () => void }) {
  const ids = useId();
  const publish = usePublishConfig('mail');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const ready = name.trim().length > 0 && reason.trim().length >= 3 && password.length > 0 && !publish.isPending;
  const live = parseConfig('mail', row.data);
  return (
    <Dialog title={t.templates.save} onClose={onClose} className="comms-template">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Never the message's own submit too (P6 review).
          e.stopPropagation();
          if (!ready) return;
          const template: MailTemplate = { id: uniqueSlug(name, live.templates.map((x) => x.id)), name: name.trim(), ...draft };
          publish.mutate({ data: { ...live, templates: [...live.templates, template] }, baseVersion: row.version, reason: reason.trim(), password }, { onSuccess: onSaved });
        }}
      >
        <p className="hint">{t.templates.hint}</p>
        <div className="field">
          <label htmlFor={`${ids}-n`}>{t.templates.name}</label>
          <div className="control">
            <input id={`${ids}-n`} type="text" maxLength={40} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-r`}>{copy.admin.fields.reason}</label>
          <div className="control">
            <input id={`${ids}-r`} type="text" maxLength={500} autoComplete="off" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-p`}>{copy.admin.fields.password}</label>
          <div className="control">
            <input id={`${ids}-p`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </div>
        {publish.error ? (
          <p className="field-error" role="alert">
            {errorText(publish.error, copy.errors)}
          </p>
        ) : null}
        <button type="submit" className="lip pill pill-solar" disabled={!ready} aria-busy={publish.isPending || undefined}>
          {t.templates.save}
        </button>
      </form>
    </Dialog>
  );
}
