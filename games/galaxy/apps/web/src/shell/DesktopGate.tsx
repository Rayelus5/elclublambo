import { type ReactNode, useEffect, useState } from 'react';
import { copy } from '../copy/es';

type WinLike = { screen: { width: number; height: number }; matchMedia(q: string): { matches: boolean } };

/**
 * Desktop only (GDD §2): a screen of at least 1280×720 and a fine pointer. It checks the SCREEN, not the viewport:
 * browser chrome takes ~100 px of a 1280×720 or 1366×768 laptop and those players must get in (the layout scrolls).
 */
export function isDesktopCapable(w: WinLike): boolean {
  return w.screen.width >= 1280 && w.screen.height >= 720 && w.matchMedia('(pointer: fine)').matches;
}

export function DesktopGate({ children, win }: { children: ReactNode; win?: WinLike }) {
  const source = win ?? window;
  const [ok, setOk] = useState(() => isDesktopCapable(source));
  useEffect(() => {
    if (win) return;
    const update = () => setOk(isDesktopCapable(window));
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [win]);

  if (ok) return <>{children}</>;
  return (
    <main className="gate">
      <div className="lip panel gate-card">
        <h1>{copy.desktop.title}</h1>
        <p>{copy.desktop.body}</p>
      </div>
    </main>
  );
}
