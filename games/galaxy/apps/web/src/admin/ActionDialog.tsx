import { type ReactNode, useId, useState } from 'react';
import { useAdminPost } from '../api/admin';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';

const t = copy.admin;

export type FieldSpec =
  | { name: string; label: string; kind: 'text' | 'number'; hint?: string; optional?: boolean }
  | { name: string; label: string; kind: 'select'; options: [string, string][] };

/**
 * A change from the panel (DESIGN_SYSTEM §8 sedecies, §8 octodecies): its fields, always a reason, and the admin's own
 * password when the change is destructive. A change with a result (the reset code) shows it here, once; the others
 * close and the page says it is done. The button says what it does when the change has a name for it.
 */
export function ActionDialog({
  url,
  title,
  submit = t.apply,
  fields = [],
  password,
  build = () => ({}),
  result,
  onDone,
  onClose,
}: {
  /** Where it posts, after `/galaxy/api`. */
  url: string;
  title: string;
  /** The submit button's text (Aplicar by default). */
  submit?: string;
  fields?: FieldSpec[];
  /** Whether this change, with these values, asks for the password. */
  password: (values: Record<string, string>) => boolean;
  build?: (values: Record<string, string>) => Record<string, unknown>;
  result?: (r: Record<string, unknown>) => ReactNode;
  onDone: (values: Record<string, string>) => void;
  onClose: () => void;
}) {
  const ids = useId();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.kind === 'select' ? f.options[0]![0] : ''])),
  );
  const [reason, setReason] = useState('');
  const [secret, setSecret] = useState('');
  const action = useAdminPost();
  const needsPassword = password(values);
  const filled = fields.every((f) => f.kind === 'select' || ('optional' in f && f.optional) || values[f.name]!.trim() !== '');
  const ready = filled && reason.trim().length >= 3 && (!needsPassword || secret.length > 0) && !action.isPending;
  const set = (name: string, v: string) => setValues((x) => ({ ...x, [name]: v }));

  return (
    <Dialog title={title} onClose={onClose} className="admin-dialog">
      {action.data && result ? (
        <>
          {result(action.data)}
          <div className="confirm-actions">
            <button type="button" className="lip pill" onClick={onClose}>
              {t.close}
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready) return;
            const body = { ...build(values), reason: reason.trim(), ...(needsPassword ? { password: secret } : {}) };
            action.mutate({ url, body }, { onSuccess: () => (result ? undefined : onDone(values)) });
          }}
        >
          {fields.map((f) => (
            <div key={f.name} className="field">
              <label htmlFor={`${ids}-${f.name}`}>{f.label}</label>
              <div className="control">
                {f.kind === 'select' ? (
                  <select id={`${ids}-${f.name}`} value={values[f.name]} onChange={(e) => set(f.name, e.target.value)}>
                    {f.options.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`${ids}-${f.name}`}
                    type="text"
                    inputMode={f.kind === 'number' ? 'numeric' : undefined}
                    autoComplete="off"
                    value={values[f.name]}
                    onChange={(e) => set(f.name, f.kind === 'number' ? e.target.value.replace(/[^\d-]/g, '') : e.target.value)}
                  />
                )}
              </div>
              {'hint' in f && f.hint ? <p className="hint">{f.hint}</p> : null}
            </div>
          ))}
          <div className="field">
            <label htmlFor={`${ids}-reason`}>{t.fields.reason}</label>
            <div className="control">
              <input id={`${ids}-reason`} type="text" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          {needsPassword ? (
            <div className="field">
              <label htmlFor={`${ids}-password`}>{t.fields.password}</label>
              <div className="control">
                <input id={`${ids}-password`} type="password" autoComplete="current-password" value={secret} onChange={(e) => setSecret(e.target.value)} />
              </div>
              <p className="hint">{t.passwordHint}</p>
            </div>
          ) : null}
          {action.error ? (
            <p className="field-error" role="alert">
              {errorText(action.error, copy.errors)}
            </p>
          ) : null}
          <div className="confirm-actions">
            <button type="button" className="lip pill" onClick={onClose}>
              {t.cancel}
            </button>
            <button type="submit" className={`lip pill ${needsPassword ? 'danger' : 'pill-solar'}`} disabled={!ready} aria-busy={action.isPending || undefined}>
              {submit}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
