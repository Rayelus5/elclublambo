import { useRadioKeys } from './useRadioKeys';

// A few choices side by side (plan «escáner pro», part A; DESIGN_SYSTEM §7): a radio group after the WAI-ARIA pattern.
// Only the chosen one takes the Tab key; the arrows move to the next choice and choose it (skipping disabled ones,
// wrapping round), Home and End go to the ends (ui/useRadioKeys.ts). Drawn like the game's other segmented controls
// (`.segmented`).

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
  const current = options.findIndex((o) => o.value === value);
  const keys = useRadioKeys(options.length, current, (i) => onChange(options[i]!.value), (i) => disabled || !!options[i]!.disabled);

  return (
    <div className={`segmented${className ? ` ${className}` : ''}`} role="radiogroup" {...labels}>
      {options.map((o, i) => (
        <button
          key={o.value}
          {...keys.item(i)}
          type="button"
          role="radio"
          data-value={o.value}
          aria-checked={o.value === value}
          disabled={disabled || o.disabled}
          onClick={() => keys.go(i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
