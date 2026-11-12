import { type ReactNode, useId, useState } from 'react';
import { useAdminPost } from '../api/admin';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { Select } from '../ui/Select';
import { Switch } from '../ui/Switch';

const t = copy.admin;

/** A field of a change; `initial` puts the value it has now (M6d-4: a level, a counter). */
export type FieldSpec =
  | { name: string; label: string; kind: 'text' | 'number'; hint?: string; optional?: boolean; initial?: string }
  | { name: string; label: string; kind: 'select'; options: [string, string][]; initial?: string }
  /** On or off (plan «escáner pro», part F: «Reservar el nombre»): its value is '1' or ''. */
  | { name: string; label: string; kind: 'switch'; hint?: string; initial?: string };

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
  intro,
  blocked = false,
  password,
  valid = () => true,
  build = () => ({}),
  result,
  onResult,
  onDone,
  onClose,
}: {
  /** Where it posts, after `/galaxy/api`. */
  url: string;
  title: string;
  /** The submit button's text (Aplicar by default). */
  submit?: string;
  fields?: FieldSpec[];
  /** What the dialog says before its fields (e.g. where each galaxy of a deal is). */
  intro?: ReactNode;
  /** The change cannot be made now (the intro says why). */
  blocked?: boolean;
  /** Whether this change, with these values, asks for the password. */
  password: (values: Record<string, string>) => boolean;
  /** Whether these values may be sent (e.g. the name typed again to delete). */
  valid?: (values: Record<string, string>) => boolean;
  build?: (values: Record<string, string>) => Record<string, unknown>;
  result?: (r: Record<string, unknown>) => ReactNode;
  /** What the server answered, once the change is made. */
  onResult?: (r: Record<string, unknown>) => void;
  onDone: (values: Record<string, string>) => void;
  onClose: () => void;
}) {
  const ids = useId();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.initial ?? (f.kind === 'select' ? f.options[0]![0] : '')])),
  );
  const [reason, setReason] = useState('');
  const [secret, setSecret] = useState('');
  const action = useAdminPost();
  const needsPassword = password(values);
  const filled = fields.every((f) => f.kind === 'select' || f.kind === 'switch' || ('optional' in f && f.optional) || values[f.name]!.trim() !== '');
  const ready = !blocked && filled && valid(values) && reason.trim().length >= 3 && (!needsPassword || secret.length > 0) && !action.isPending;
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
            action.mutate(
              { url, body },
              {
                onSuccess: (r) => {
                  onResult?.(r);
                  if (!result) onDone(values);
                },
              },
            );
          }}
        >
          {intro}
          {fields.map((f) =>
            f.kind === 'switch' ? (
              <div key={f.name} className="field admin-toggle">
                <span id={`${ids}-${f.name}`} className="admin-toggle-label">
                  {f.label}
                </span>
                <Switch checked={values[f.name] === '1'} aria-labelledby={`${ids}-${f.name}`} aria-describedby={f.hint ? `${ids}-${f.name}-hint` : undefined} onChange={(on) => set(f.name, on ? '1' : '')} />
                {f.hint ? (
                  <p id={`${ids}-${f.name}-hint`} className="hint">
                    {f.hint}
                  </p>
                ) : null}
              </div>
            ) : (
            <div key={f.name} className="field">
              <label htmlFor={`${ids}-${f.name}`}>{f.label}</label>
              <div className="control">
                {f.kind === 'select' ? (
                  <Select id={`${ids}-${f.name}`} size="lg" block value={values[f.name]!} options={f.options.map(([value, label]) => ({ value, label }))} onChange={(v) => set(f.name, v)} />
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
            ),
          )}
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
