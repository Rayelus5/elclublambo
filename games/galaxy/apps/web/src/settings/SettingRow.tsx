import { type ReactNode, useId } from 'react';

// One setting (plan «escáner pro», part A): what it is and a line on what it does on the left, its control on the
// right. The control gets the ids of both, so its accessible name and description are the visible texts.

export interface SettingIds {
  label: string;
  hint: string | undefined;
}

export function SettingRow({
  label,
  hint,
  layout = 'side',
  off = false,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** `wide` gives the control more room (sliders); `stack` puts it under the texts (long choices). */
  layout?: 'side' | 'wide' | 'stack';
  /** Shown dimmed while it does not apply (e.g. the volumes while everything is muted). */
  off?: boolean;
  children: (ids: SettingIds) => ReactNode;
}) {
  const id = useId();
  const ids: SettingIds = { label: `${id}-label`, hint: hint ? `${id}-hint` : undefined };
  return (
    <div className={`setting setting-${layout}${off ? ' is-off' : ''}`}>
      <div className="setting-text">
        <span className="setting-label" id={ids.label}>
          {label}
        </span>
        {hint ? (
          <p className="setting-hint" id={ids.hint}>
            {hint}
          </p>
        ) : null}
      </div>
      <div className="setting-control">{children(ids)}</div>
    </div>
  );
}
