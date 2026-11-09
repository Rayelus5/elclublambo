import { useId, useState } from 'react';
import { ApiError } from '../api/client';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';

const t = copy.admin.config;

/** The issues the server found in a publish it refused (config_invalid), if any. */
function serverIssues(error: unknown): { key?: string; path: string; message: string }[] {
  const issues = error instanceof ApiError ? error.details.issues : undefined;
  return Array.isArray(issues) ? (issues as { key?: string; path: string; message: string }[]) : [];
}

/** Reason and the admin's password, then publish (DESIGN_SYSTEM §8 septendecies). */
export function PublishFields({ busy, disabled, error, label = t.publish, onPublish }: { busy: boolean; disabled: boolean; error: unknown; label?: string; onPublish: (reason: string, password: string) => void }) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const ready = !disabled && !busy && reason.trim().length >= 3 && password.length > 0;
  return (
    <form
      className="admin-publish"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onPublish(reason.trim(), password);
      }}
    >
      <div className="field">
        <label htmlFor={`${id}-r`}>{copy.admin.fields.reason}</label>
        <div className="control">
          <input id={`${id}-r`} type="text" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${id}-p`}>{copy.admin.fields.password}</label>
        <div className="control">
          <input id={`${id}-p`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </div>
      {error ? (
        <div className="field-error" role="alert">
          <p>{errorText(error, copy.errors)}</p>
          {serverIssues(error).length ? (
            <ul className="admin-issues">
              {serverIssues(error).map((i) => (
                <li key={`${i.key ?? ''}:${i.path}:${i.message}`}>
                  <code>{[i.key, i.path].filter(Boolean).join('.') || '·'}</code> {i.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <button type="submit" className="lip pill danger" disabled={!ready} aria-busy={busy || undefined}>
        {label}
      </button>
    </form>
  );
}
