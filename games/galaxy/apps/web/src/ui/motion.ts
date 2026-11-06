import { useSyncExternalStore } from 'react';

// `prefers-reduced-motion` as React state (DESIGN_SYSTEM §5): components that move on their own or follow the pointer
// read it and stay still. Without matchMedia (old browsers, tests) motion is allowed.
const QUERY = '(prefers-reduced-motion: reduce)';

function media(): MediaQueryList | null {
  return typeof matchMedia === 'function' ? matchMedia(QUERY) : null;
}

function subscribe(onChange: () => void): () => void {
  const m = media();
  m?.addEventListener?.('change', onChange);
  return () => m?.removeEventListener?.('change', onChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => media()?.matches ?? false, () => false);
}
