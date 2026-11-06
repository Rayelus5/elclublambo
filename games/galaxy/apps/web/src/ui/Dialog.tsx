import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// A modal panel (DESIGN_SYSTEM §7): named by its title, focus moves in (to [data-autofocus] or the first control),
// Tab stays inside, Escape or a click on the backdrop closes it (unless the dialog says otherwise), and focus goes
// back where it was.
const FOCUSABLE = 'a[href], button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  title,
  onClose,
  children,
  role = 'dialog',
  className = '',
  hideTitle = false,
  closeOnVeil = true,
  onEscape,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** `alertdialog` for confirmations of something that cannot be undone. */
  role?: 'dialog' | 'alertdialog';
  className?: string;
  hideTitle?: boolean;
  /** False where a stray click must not lose anything (the reveal). */
  closeOnVeil?: boolean;
  /** What Escape does, when it is not simply closing. */
  onEscape?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = ref.current;
    (node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE) ?? node)?.focus();
    return () => before?.focus();
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      (onEscape ?? onClose)();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className="overlay" onMouseDown={(e) => closeOnVeil && e.target === e.currentTarget && onClose()}>
      <div ref={ref} role={role} aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`lip panel modal ${className}`} onKeyDown={onKeyDown}>
        <h2 id={titleId} className={hideTitle ? 'sr-only' : 'modal-title'}>
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
