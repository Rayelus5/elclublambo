import { useSyncExternalStore } from 'react';
import { reducedFor, systemReduced, usePrefs } from '../settings/prefs';

// Reduced motion as React state (DESIGN_SYSTEM §5): components that move on their own or follow the pointer read it
// and stay still. Ajustes → Accesibilidad decides (plan «escáner pro», part A): «Sistema» follows the operating system's
// `prefers-reduced-motion`, «Reducido» and «Completo» override it. Code outside React reads `prefersReduced()`
// (settings/prefs.ts); the CSS reads <html data-motion>.
const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  let m: MediaQueryList | null = null;
  try {
    m = typeof matchMedia === 'function' ? matchMedia(QUERY) : null;
  } catch {
    m = null;
  }
  m?.addEventListener?.('change', onChange);
  return () => m?.removeEventListener?.('change', onChange);
}

export function useReducedMotion(): boolean {
  const motion = usePrefs((p) => p.motion);
  const os = useSyncExternalStore(subscribe, systemReduced, () => false);
  return reducedFor(motion, os);
}
