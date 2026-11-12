import type { PulledGalaxy } from '@galaxy/shared';
import { lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { onSettings } from '../../audio/mixer';
import { holdMusic } from '../../audio/music';
import { copy } from '../../copy/es';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { useReducedMotion } from '../../ui/motion';
import { RevealSummary } from '../RevealSummary';
import { sfx } from '../sfx';
import type { CinemaControl, ProOverlay } from './ProCinema';
import type { Phase, PhaseKind } from './script';
import { proAudio } from './sounds';

// The pro scanner's shell (plan «escáner pro», part B; the owner: «bandanas negras cerrando la pantalla de arriba hacia
// abajo y de abajo hacia arriba, hasta que la pantalla se quede en negro absoluto»). It lives in the main chunk, so
// the bands close the instant the player scans — while the request is still out — and the cinema (GSAP and three.js,
// lazy) takes over when the galaxies arrive. The shell owns what must always work: the dialog and its focus, «Saltar»,
// «Seguir» (a click anywhere, Space), the mute, the announcements, the overlays the cinema paints, and the summary.
// If the request fails, the bands open again and the scanner says why.

const ProCinema = lazy(() => import('./ProCinema'));

/** Fetches the cinema's chunk ahead (on the scanner screen, when the browser is idle). */
export function preloadProCinema() {
  void import('./ProCinema');
}

type State = 'closing' | 'playing' | 'summary' | 'failing';

export function ProShell({
  pulls,
  title = copy.scanner.revealTitle,
  onClose,
  actions,
  status,
  failed = false,
  onAbort,
  summaryOnly = false,
  rehearsal,
  direction,
}: {
  /** null while the scan's request is out (the bands are closing). */
  pulls: readonly PulledGalaxy[] | null;
  title?: string;
  onClose: () => void;
  actions?: ReactNode;
  status?: ReactNode;
  /** The request failed: the bands open again, then `onAbort`. */
  failed?: boolean;
  onAbort?: () => void;
  /** Straight to the summary (a failed «¡Escanear otra!» comes back to the last one). */
  summaryOnly?: boolean;
  /** The Ensayo's own controls, shown over the stage. */
  rehearsal?: (control: CinemaControl | null, phase: Phase | null) => ReactNode;
  /** The Ensayo's direction for the cinema. */
  direction?: { overrides?: Readonly<Partial<Record<PhaseKind, number>>>; surge?: boolean; rate?: number; take?: number; motion?: 'full' | 'reduced' };
}) {
  const systemReduced = useReducedMotion();
  const reduced = direction?.motion ? direction.motion === 'reduced' : systemReduced;
  // What the cinema of these pulls reported (a new scan starts clean: state from another scan is ignored).
  const [seen, setSeen] = useState<{ of: readonly PulledGalaxy[] | null; phase: Phase | null; lost: boolean; said: string; control: CinemaControl | null }>({ of: null, phase: null, lost: false, said: '', control: null });
  const mine = seen.of === pulls && !!pulls;
  const phase = mine ? seen.phase : null;
  const lost = mine && seen.lost;
  const said = mine ? seen.said : '';
  const update = (patch: Partial<typeof seen>) => setSeen((s) => ({ ...(s.of === pulls ? s : { of: pulls, phase: null, lost: false, said: '', control: null }), ...patch }));
  const [waiting, setWaiting] = useState(false);
  const [muted, setMuted] = useState(sfx.muted());
  const overlay = useRef<ProOverlay | null>(null);
  const control = useRef<CinemaControl | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLDivElement>(null);
  const name = useRef<HTMLElement>(null);
  const tier = useRef<HTMLSpanElement>(null);
  const phenomenon = useRef<HTMLSpanElement>(null);

  const showSummary = !!pulls && (summaryOnly || lost || phase?.kind === 'resumen');
  const state: State = failed ? 'failing' : !pulls ? 'closing' : showSummary && (summaryOnly || lost) ? 'summary' : 'playing';

  // The game's music waits while the scanner's plays; the bands closing sound once per scan.
  useEffect(() => {
    holdMusic(true);
    return () => holdMusic(false);
  }, []);
  useEffect(() => {
    if (pulls || failed) return;
    const audio = proAudio();
    audio?.bank.play('cierre', audio.ctx.currentTime + 0.01, audio.sfx, {});
  }, [pulls, failed]);
  // A failed scan: the bands open (0.35 s), then the scanner screen shows why.
  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => onAbort?.(), reduced ? 0 : 350);
    return () => clearTimeout(timer);
  }, [failed, onAbort, reduced]);
  useEffect(() => onSettings((s) => setMuted(s.muted)), []);
  useEffect(() => {
    overlay.current = root.current && caption.current && name.current && tier.current && phenomenon.current ? { root: root.current, caption: caption.current, name: name.current, tier: tier.current, phenomenon: phenomenon.current } : null;
  });

  const advance = () => {
    if (showSummary) return;
    control.current?.advance();
  };
  const skip = () => {
    if (showSummary) return;
    control.current?.skip();
  };
  // Space advances (never skips everything), even with a button focused.
  useEffect(() => {
    if (showSummary || !pulls) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      control.current?.advance();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [showSummary, pulls]);

  const holding = phase?.hold === true;
  return (
    <Dialog title={title} onClose={onClose} hideTitle closeOnVeil={false} className="pro-stage" onEscape={() => (showSummary || !pulls ? (pulls ? onClose() : undefined) : skip())}>
      <div ref={root} className="pro-root" data-state={state} data-phase={phase?.kind ?? 'none'} data-reduced={reduced || undefined} onClick={(e) => e.target === e.currentTarget && advance()}>
        {pulls && !summaryOnly && !lost ? (
          <Suspense fallback={null}>
            <ProCinema
              key={`${pulls[0]?.id ?? 'none'}:${direction?.take ?? 0}`}
              pulls={pulls}
              reduced={reduced}
              overlay={overlay}
              control={control}
              onPhase={(p) => update({ phase: p })}
              onFace={(_, g) => update({ said: copy.scanner.found(copy.tiers[g.tier], g.name) })}
              onWait={setWaiting}
              onLost={() => update({ lost: true })}
              onReady={(control) => update({ control })}
              overrides={direction?.overrides}
              surge={direction?.surge}
              rate={direction?.rate}
            />
          </Suspense>
        ) : null}
        <div className="pro-veil" aria-hidden="true" onClick={advance} />
        <div className="pro-flash" aria-hidden="true" />
        <div className="pro-bar top" aria-hidden="true" />
        <div className="pro-bar bottom" aria-hidden="true" />

        {!pulls || waiting ? (
          <p className="pro-wait" role="status">
            <span className="pro-wait-star" aria-hidden="true" />
            <span>{!pulls ? copy.scanner.linking : copy.scanner.resolving}</span>
          </p>
        ) : null}

        <div className="pro-hud">
          <span className="pro-progress">{phase?.slot !== undefined && pulls && pulls.length > 1 ? copy.scanner.progress(phase.slot + 1, pulls.length) : ''}</span>
          <div className="pro-tools">
            <button
              type="button"
              className="lip iconbtn pro-mute"
              aria-pressed={muted}
              aria-label={muted ? copy.scanner.unmute : copy.scanner.mute}
              title={muted ? copy.scanner.unmute : copy.scanner.mute}
              onClick={() => {
                sfx.setMuted(!muted);
                setMuted(!muted);
              }}
            >
              <Icon name={muted ? 'mute' : 'sound'} />
            </button>
            {pulls && !showSummary ? (
              <button type="button" className="lip pill pro-skip" data-autofocus onClick={skip}>
                {copy.scanner.skip}
              </button>
            ) : null}
          </div>
        </div>

        <div ref={caption} className="pro-caption" aria-hidden="true">
          <b ref={name} className="pro-name" />
          <span className="pro-tier">
            <span className="pro-pips" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <i key={i} />
              ))}
            </span>
            <span ref={tier} />
          </span>
        </div>
        <span className="pro-featured" aria-hidden="true">
          {copy.scanner.featuredFound}
        </span>
        <span className="pro-phenomenon" aria-hidden="true">
          <b>{copy.scanner.phenomenon}</b>
          <span ref={phenomenon} />
        </span>

        {pulls && !showSummary ? (
          <button type="button" className={`lip pill pro-next${holding ? ' is-holding' : ''}`} onClick={advance}>
            <span>{holding ? copy.scanner.tapToContinue : copy.scanner.next}</span>
            <kbd aria-hidden="true">{copy.scanner.spaceKey}</kbd>
          </button>
        ) : null}

        {showSummary && pulls ? (
          <div className="pro-summary-wrap">
            <RevealSummary className="stage-summary pro-summary" pulls={pulls} status={lost ? <p className="summary-missing">{copy.scanner.lostLink}</p> : status} actions={actions} onClose={onClose} reduced={reduced} />
          </div>
        ) : null}
        {rehearsal ? <div className="pro-rehearsal">{rehearsal(mine ? seen.control : null, phase)}</div> : null}
        <p className="sr-only" aria-live="polite">
          {said}
        </p>
      </div>
    </Dialog>
  );
}
