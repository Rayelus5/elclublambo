import { type InputHTMLAttributes, type Ref, useId, useState } from 'react';
import { copy } from '../copy/es';
import { Icon } from './Icon';

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string;
  hint?: string;
  /** When set, the field is invalid and this text is its accessible description (instead of the hint). */
  error?: string;
  /** Invalid without a field-level text (the form summary explains it). */
  invalid?: boolean;
  /** Shows a check when the value is known to be valid. */
  valid?: boolean;
  password?: boolean;
  ref?: Ref<HTMLInputElement>;
};

/**
 * Labelled input (DESIGN_SYSTEM §7): visible label above, hint below, the error replaces the hint and is linked with
 * aria-describedby; passwords get a show/hide toggle. Paste always works.
 */
export function Field({ label, hint, error, invalid, valid, password, className, ref, ...input }: FieldProps) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={['field', error || invalid ? 'bad' : '', valid && !error ? 'good' : '', password ? 'pw' : '', className ?? ''].join(' ')}>
      <label htmlFor={id}>{label}</label>
      <div className="control">
        <input
          {...input}
          ref={ref}
          id={id}
          type={password ? (shown ? 'text' : 'password') : (input.type ?? 'text')}
          aria-invalid={error || invalid ? true : undefined}
          aria-describedby={describedBy}
        />
        {password ? (
          <button
            type="button"
            className="eye"
            aria-label={shown ? copy.fields.hidePassword : copy.fields.showPassword}
            aria-pressed={shown}
            onClick={() => setShown((s) => !s)}
          >
            <Icon name={shown ? 'eyeOff' : 'eye'} />
          </button>
        ) : (
          <Icon name="check" className="ico ok" />
        )}
      </div>
      {error ? (
        <div className="err" id={`${id}-err`}>
          {error}
        </div>
      ) : hint ? (
        <div className="hint" id={`${id}-hint`}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}
