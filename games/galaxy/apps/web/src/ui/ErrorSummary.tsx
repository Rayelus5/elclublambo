import { useEffect, useRef } from 'react';
import { Icon } from './Icon';

/**
 * Form-level error (DESIGN_SYSTEM §7): role=alert, and it takes the focus each time a new error appears, so keyboard
 * and screen-reader users land on it after a failed submit.
 */
export function ErrorSummary({ message, tone = 'error' }: { message?: string | null; tone?: 'error' | 'info' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message && tone === 'error') ref.current?.focus();
  }, [message, tone]);
  if (!message) return null;
  return (
    <div ref={ref} className={`summary ${tone}`} role={tone === 'error' ? 'alert' : 'status'} tabIndex={-1}>
      <Icon name={tone === 'error' ? 'alert' : 'check'} />
      <span>{message}</span>
    </div>
  );
}
