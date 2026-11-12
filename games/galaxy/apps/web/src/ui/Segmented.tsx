import { type KeyboardEvent, useRef } from 'react';

// A few choices side by side (plan «escáner pro», part A; DESIGN_SYSTEM §7): a radio group after the WAI-ARIA pattern.
// Only the chosen one takes the Tab key; the arrows move to the next choice and choose it (skipping disabled ones,
// wrapping round), Home and End go to the ends. Drawn like the game's other segmented controls (`.segmented`).

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
  disabled?: boolean;
}

type Labels = { 'aria-label'?: string; 'aria-labelledby'?: string; 'aria-describedby'?: string };

export type SegmentedProps<V extends string> = Labels & {
  value: V;
  options: readonly SegmentedOption<V>[];
  onChange: (value: V) => void;
  disabled?: boolean;
  className?: string;
};

export function Segmented<V extends string>({ value, options, onChange, disabled = false, className, ...labels }: SegmentedProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const usable = options.map((o, i) => (o.disabled || disabled ? -1 : i)).filter((i) => i >= 0);
  const current = options.findIndex((o) => o.value === value);
  // The one that takes Tab: the chosen one, or the first usable when none is chosen.
  const stop = current >= 0 && !options[current]!.disabled ? current : (usable[0] ?? -1);

  const go = (index: number) => {
    const o = options[index];
    if (!o) return;
    refs.current[index]?.focus();
    if (o.value !== value) onChange(o.value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (usable.length === 0) return;
    const at = usable.indexOf(index);
    let next: number | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = usable[(at + 1) % usable.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = usable[(at - 1 + usable.length) % usable.length];
    else if (e.key === 'Home') next = usable[0];
    else if (e.key === 'End') next = usable[usable.length - 1];
    if (next === undefined) return;
    e.preventDefault();
    go(next);
  };

  return (
    <div className={`segmented${className ? ` ${className}` : ''}`} role="radiogroup" {...labels}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === stop ? 0 : -1}
          disabled={disabled || o.disabled}
          onClick={() => go(i)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
