import type { PopupIssue } from '@galaxy/shared';
import { type ReactNode, useId } from 'react';
import { Switch } from '../../ui/Switch';
import { NumberInput } from '../forms/ConfigForm';
import { issueText } from './shared';

// The small pieces of the popups' wizard (plan 2026-11-22, part A): a field's problems in words, a switch with what it
// does (and the fields it opens), a line of text and a number, with the panel's own controls.

/** The problems of a field (`path`) and of what is inside it, in words. */
export function Problems({ issues, path, exact = false }: { issues: readonly PopupIssue[]; path: string; exact?: boolean }) {
  const mine = issues.filter((i) => i.path === path || (!exact && i.path.startsWith(`${path}.`)));
  if (!mine.length) return null;
  return (
    <ul className="cf-problems">
      {mine.map((i) => (
        <li key={i.path + i.message}>{issueText(i)}</li>
      ))}
    </ul>
  );
}

/** Whether a field (or anything inside it) has a problem. */
export const hasIssue = (issues: readonly PopupIssue[], path: string) => issues.some((i) => i.path === path || i.path.startsWith(`${path}.`));

/** A switch with its name and what it does, and the fields it opens when on. */
export function ToggleRow({ label, hint, checked, onChange, children }: { label: string; hint: string; checked: boolean; onChange: (on: boolean) => void; children?: ReactNode }) {
  const id = useId();
  return (
    <div className={`apop-toggle${checked ? ' on' : ''}`}>
      <div className="apop-toggle-head">
        <span id={`${id}-l`} className="apop-toggle-label">
          {label}
        </span>
        <Switch aria-labelledby={`${id}-l`} aria-describedby={`${id}-h`} checked={checked} onChange={onChange} />
      </div>
      <p id={`${id}-h`} className="cf-hint">
        {hint}
      </p>
      {checked && children ? <div className="apop-toggle-body">{children}</div> : null}
    </div>
  );
}

/** A line of text with its label, hint and problems. */
export function TextRow({
  label,
  value,
  max,
  onChange,
  hint,
  issues = [],
  path,
  wide = false,
  multiline = false,
}: {
  label: string;
  value: string;
  max: number;
  onChange: (v: string) => void;
  hint?: string;
  issues?: readonly PopupIssue[];
  path?: string;
  wide?: boolean;
  multiline?: boolean;
}) {
  const id = useId();
  const bad = path ? hasIssue(issues, path) : false;
  const props = { id, maxLength: max, value, 'aria-invalid': bad || undefined, 'aria-describedby': hint ? `${id}-h` : undefined };
  return (
    <div className={`cf-field${wide ? ' apop-wide' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {multiline ? <textarea {...props} rows={5} onChange={(e) => onChange(e.target.value)} /> : <input {...props} type="text" autoComplete="off" onChange={(e) => onChange(e.target.value)} />}
      {hint ? (
        <small id={`${id}-h`} className="cf-hint">
          {hint}
        </small>
      ) : null}
      {path ? <Problems issues={issues} path={path} /> : null}
    </div>
  );
}

/** A whole number with its label, in the config forms' own control. */
export function NumberRow({ label, value, onChange, hint, invalid = false }: { label: string; value: number; onChange: (n: number) => void; hint?: string; invalid?: boolean }) {
  const id = useId();
  return (
    <div className="cf-field">
      <label htmlFor={id}>{label}</label>
      <NumberInput id={id} value={value} info={{ label }} invalid={invalid} onChange={(v) => onChange(Math.round(v ?? 0))} />
      {hint ? <small className="cf-hint">{hint}</small> : null}
    </div>
  );
}
