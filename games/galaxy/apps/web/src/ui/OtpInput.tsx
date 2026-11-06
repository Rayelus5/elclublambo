import { useId, useState } from 'react';

/**
 * Six-digit code as ONE real input (one-time-code autofill, paste with spaces works) drawn as six cells. Non-digits
 * are dropped and the value is capped at 6.
 */
export function OtpInput({
  label,
  hint,
  value,
  onChange,
  invalid,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={['otp', focused ? 'focus' : '', invalid ? 'bad' : ''].join(' ')}>
        <input
          id={id}
          value={value}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          aria-describedby={`${id}-hint`}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <div className="cells" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className={[i < value.length ? 'filled' : '', i === Math.min(value.length, 5) ? 'cur' : ''].join(' ')}>
              {value[i] ?? ''}
            </span>
          ))}
        </div>
      </div>
      <div className="hint" id={`${id}-hint`}>
        {hint}
      </div>
    </div>
  );
}
