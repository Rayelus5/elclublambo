import { useEffect, useId, useRef, useState } from 'react';
import { copy } from '../copy/es';
import { Icon } from './Icon';

// Copying a text with one press (plan «referidos», part R2: an invitation code or its link). The button says «Copiado»
// for a moment, and a quiet live region says it too. When the browser refuses the clipboard (no permission, an old
// browser, an insecure page), the text shows instead in a field, selected and focused, with how to copy it by hand.

const SHOWN_MS = 1800;

/** A button that copies `text`, or shows it selected to copy by hand when the browser will not. */
export function CopyButton({
  text,
  label,
  name,
  className = '',
}: {
  text: string;
  /** What the button says («Copiar enlace»). */
  label: string;
  /** Its accessible name, which starts with `label` («Copiar enlace de VEGA-7K2P»). */
  name: string;
  className?: string;
}) {
  const hint = useId();
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state === 'manual') {
      field.current?.focus();
      field.current?.select();
      return;
    }
    if (state !== 'copied') return;
    const id = setTimeout(() => setState('idle'), SHOWN_MS);
    return () => clearTimeout(id);
  }, [state]);

  async function press(): Promise<void> {
    try {
      if (!navigator.clipboard) throw new Error('no_clipboard');
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('manual');
    }
  }

  if (state === 'manual') {
    return (
      <span className={`copy-manual ${className}`}>
        <input
          ref={field}
          type="text"
          readOnly
          value={text}
          size={Math.min(48, Math.max(8, text.length))}
          aria-label={name}
          aria-describedby={hint}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => setState('idle')}
        />
        <small id={hint}>{copy.clipboard.manual}</small>
      </span>
    );
  }
  return (
    <>
      <button type="button" className={`lip pill small copy-button ${className}`} data-copied={state === 'copied' || undefined} aria-label={name} onClick={() => void press()}>
        <Icon name={state === 'copied' ? 'tick' : 'copy'} />
        <span>{state === 'copied' ? copy.clipboard.copied : label}</span>
      </button>
      <span className="sr-only" role="status">
        {state === 'copied' ? copy.clipboard.copied : ''}
      </span>
    </>
  );
}
