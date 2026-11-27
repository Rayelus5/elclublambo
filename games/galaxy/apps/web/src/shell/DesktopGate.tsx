import { type DeviceEnv, isMobileDevice } from '@galaxy/shared';
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { spriteDataUrl } from '../arena/sprites';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';
import { Logo } from './AuthLayout';
import shotUrl from './gate-art/incursion.webp';

/**
 * Computers only (GDD §2): a phone or a tablet sees «se juega en ordenador» instead of the game. The DEVICE decides,
 * never its screen's size (the owner, 2026-11-27): a laptop's browser reports its screen divided by the system's
 * scaling, so laptops at 125 % or 150 % got the phone notice. A small window on a computer plays (the layout scrolls).
 */
export function isDesktopCapable(env: DeviceEnv): boolean {
  return !isMobileDevice(env);
}

/** The game's address on this host («galaxysurvivor.es/galaxy»), to open on a computer. */
function gameLink(): { url: string; shown: string } {
  const url = `${window.location.origin}/galaxy`;
  return { url, shown: `${window.location.host}/galaxy` };
}

/** The probes that fly over the notice: the game's own art, whole pixels. */
const FLEET = [
  { sprite: 'probe-lumen', scale: 6, cls: 'lead' },
  { sprite: 'probe-spark', scale: 4, cls: 'wing-l' },
  { sprite: 'probe-prism', scale: 4, cls: 'wing-r' },
];

/**
 * The phone notice (2026-11-27, «más llamativo»): the game running behind, its logo and a small fleet of probes, and a
 * card that says it is played on a computer, with the link to send to yourself (the phone's share sheet, or a copy) and
 * the landing that tells what the game is.
 */
function PhoneNotice() {
  const t = copy.desktop;
  const link = gameLink();
  const [said, setSaid] = useState('');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link.url);
      setSaid(t.copied);
    } catch {
      setSaid(t.copyFailed);
    }
  }
  async function share(): Promise<void> {
    try {
      await navigator.share({ title: 'Galaxy Survivor', text: t.shareText, url: link.url });
    } catch {
      // Closed without sending, or not allowed: the copy button and the link above are still there.
    }
  }
  return (
    <main className="gate">
      <div className="gate-sky" aria-hidden="true">
        <span className="gate-shot" style={{ backgroundImage: `url(${shotUrl})` }} />
        <span className="gate-stars" />
        <span className="gate-vignette" />
      </div>
      <div className="gate-inner">
        <Logo />
        <div className="gate-fleet" aria-hidden="true">
          {FLEET.map((p, i) => (
            <span key={p.sprite} className={`gate-probe ${p.cls}`} style={{ '--i': i } as CSSProperties}>
              <img src={spriteDataUrl(p.sprite, p.scale)} alt="" />
              <i className="gate-flame" />
            </span>
          ))}
        </div>
        <section className="lip panel gate-card enter" style={{ '--d': '.25s' } as CSSProperties} aria-labelledby="gate-title">
          <span className="gate-badge">
            <Icon name="monitor" />
            {t.badge}
          </span>
          <h2 id="gate-title">{t.title}</h2>
          <p>{t.body}</p>
          <p className="gate-url">
            <span className="sr-only">{t.linkLabel}: </span>
            {link.shown}
          </p>
          <div className="gate-actions">
            {canShare ? (
              <button type="button" className="lip pill pill-solar gate-go" onClick={() => void share()}>
                <Icon name="share" />
                <span>{t.share}</span>
              </button>
            ) : null}
            <button type="button" className={`lip pill gate-copy${canShare ? '' : ' pill-solar gate-go'}`} onClick={() => void copyLink()}>
              <Icon name="copy" />
              <span>{t.copy}</span>
            </button>
          </div>
          <p className="gate-said" role="status">
            {said}
          </p>
          <a className="gate-landing" href="/">
            {t.landing}
          </a>
        </section>
      </div>
    </main>
  );
}

export function DesktopGate({ children, win }: { children: ReactNode; win?: DeviceEnv }) {
  const source = win ?? window;
  const [ok, setOk] = useState(() => isDesktopCapable(source));
  useEffect(() => {
    if (win) return;
    // A mouse plugged into a tablet, or a phone's browser switched to its desktop view: ask again.
    const update = () => setOk(isDesktopCapable(window));
    const fine = window.matchMedia('(any-pointer: fine)');
    window.addEventListener('resize', update);
    fine.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('resize', update);
      fine.removeEventListener?.('change', update);
    };
  }, [win]);

  if (ok) return <>{children}</>;
  return <PhoneNotice />;
}
