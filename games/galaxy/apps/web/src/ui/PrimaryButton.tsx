import { type ButtonHTMLAttributes, useEffect, useState } from 'react';
import { prefersReduced } from '../settings/prefs';

const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

/** Braille spinner (DESIGN_SYSTEM §5): 80 ms per frame; with reduced motion it stays on one frame. */
function BrailleSpinner() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (prefersReduced()) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % FRAMES.length), 80);
    return () => window.clearInterval(t);
  }, []);
  return (
    <span className="spin" aria-hidden="true">
      {FRAMES[i]}
    </span>
  );
}

/** The hero action of a screen (Solar, 7 px lip). While busy it keeps its name, shows the spinner and is aria-busy. */
export function PrimaryButton({
  busy,
  children,
  className,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button {...rest} className={['lip primary', className ?? ''].join(' ')} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? <BrailleSpinner /> : null}
      <span className="label">{children}</span>
    </button>
  );
}
