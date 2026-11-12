import type { CSSProperties } from 'react';

// The game's slider (plan «escáner pro», part A; DESIGN_SYSTEM §7): a native range — so the keys, touch and screen
// readers work as everywhere — drawn as a sunken track with a solar fill and a knob with a lip. The fill is a CSS
// custom property set through the style object (CSSOM, allowed by the CSP). The value is shown beside it in an
// <output> and read out with `valueText`.

type Labels = { 'aria-label'?: string; 'aria-labelledby'?: string; 'aria-describedby'?: string };

export type SliderProps = Labels & {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  id?: string;
  /** What the value says, both on screen and to screen readers (e.g. «80 %»). */
  valueText?: (value: number) => string;
  className?: string;
};

export function Slider({ value, onChange, min = 0, max = 100, step = 5, disabled = false, id, valueText, className, ...labels }: SliderProps) {
  const span = max - min;
  const fill = span > 0 ? Math.min(100, Math.max(0, ((value - min) / span) * 100)) : 0;
  const text = valueText?.(value);
  return (
    <div className={`slider${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`} style={{ '--fill': `${Math.round(fill * 100) / 100}%` } as CSSProperties}>
      <input
        id={id}
        className="slider-input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={text}
        onChange={(e) => onChange(Number(e.target.value))}
        {...labels}
      />
      {text !== undefined ? (
        <output className="slider-value" htmlFor={id} aria-hidden="true">
          {text}
        </output>
      ) : null}
    </div>
  );
}
