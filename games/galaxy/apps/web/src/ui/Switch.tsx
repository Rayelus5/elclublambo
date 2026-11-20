import { Icon } from './Icon';

// The game's on/off switch (plan «escáner pro», part A; DESIGN_SYSTEM §7): a button with role="switch" after the
// WAI-ARIA pattern (Space and Enter toggle it, like any button), drawn as a sunken track whose knob slides over and
// turns terminal green with a tick when on. It never stands alone: a visible label names it (aria-labelledby).

type Labels = { 'aria-label'?: string; 'aria-labelledby'?: string; 'aria-describedby'?: string };

export type SwitchProps = Labels & {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
};

export function Switch({ checked, onChange, disabled = false, id, className, ...labels }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`switch${className ? ` ${className}` : ''}`}
      onClick={() => onChange(!checked)}
      {...labels}
    >
      <span className="switch-knob" aria-hidden="true">
        <Icon name="tick" />
      </span>
    </button>
  );
}
