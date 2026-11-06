import { TIERS, type PulledGalaxy } from '@galaxy/shared';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { composeInto } from '../galaxy/compose';
import { loadRender } from '../galaxy/images';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../ui/motion';
import { advance, revealSequence, skipToSummary, type Step } from './reveal-sequence';
import { sfx } from './sfx';

// The deep-field scan on screen (GDD §9, DESIGN_SYSTEM §8 bis). It plays revealSequence(): a CRT terminal sweeps
// static, the signal bars climb, the scan line in the rarity's colour resolves the real engine image dot by dot,
// a phenomenon is announced, a Legendary makes the screen fail, and the card lands. A tap (or Space) goes to the
// pull's card or the next pull; Saltar goes to the summary. Each revealed galaxy is announced politely.
const IMAGE_PX = 420;
const names = copy.traitValues.phenomenon as Record<string, string>;

/** Composes every pull's image ahead of its scan (cache → Worker), in order. null: it could not be drawn. */
function usePulledImages(pulls: readonly PulledGalaxy[]): (HTMLCanvasElement | null | undefined)[] {
  const [images, setImages] = useState<(HTMLCanvasElement | null | undefined)[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    const px = Math.min(1024, Math.round(IMAGE_PX * (globalThis.devicePixelRatio || 1)));
    pulls.forEach((p, i) => {
      loadRender(BigInt(p.seed), 96, controller.signal).then(
        (render) => {
          const canvas = document.createElement('canvas');
          const ok = composeInto(canvas, render, px);
          setImages((now) => Object.assign([...now], { [i]: ok ? canvas : null }));
        },
        (e: unknown) => {
          if ((e as { name?: string }).name !== 'AbortError') setImages((now) => Object.assign([...now], { [i]: null }));
        },
      );
    });
    return () => controller.abort();
  }, [pulls]);
  return images;
}

/** CRT static: coarse noise redrawn ~12 times a second (low contrast, never a flash); one still frame when reduced. */
function Static({ still }: { still: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const img = ctx.createImageData(canvas.width, canvas.height);
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      if (t - last > 80) {
        last = t;
        for (let i = 0; i < img.data.length; i += 4) {
          const v = 30 + Math.random() * 90;
          img.data[i] = v * 0.8;
          img.data[i + 1] = v * 0.9;
          img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      }
      if (!still) raf = requestAnimationFrame(draw);
    };
    draw(100);
    return () => cancelAnimationFrame(raf);
  }, [still]);
  return <canvas ref={ref} className="crt-static" width={160} height={120} aria-hidden="true" />;
}

function Scan({ canvas, step }: { canvas: HTMLCanvasElement | null | undefined; step: Step }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el || !canvas) return;
    el.prepend(canvas);
    return () => canvas.remove();
  }, [canvas]);
  return (
    <div
      ref={host}
      className="crt-image"
      data-kind={step.kind}
      data-ready={canvas ? 'true' : 'false'}
      style={{ '--scan-ms': `${Number.isFinite(step.ms) ? step.ms : 0}ms` } as CSSProperties}
    >
      {step.kind === 'scan' ? <div className="crt-scanline" /> : null}
    </div>
  );
}

export function RevealStage({
  pulls,
  title = copy.scanner.revealTitle,
  onClose,
  actions,
}: {
  pulls: readonly PulledGalaxy[];
  title?: string;
  onClose: () => void;
  /** Extra buttons in the summary (Escanear otra vez, Ver en la colección…). */
  actions?: ReactNode;
}) {
  const reduced = useReducedMotion();
  const steps = useMemo(() => revealSequence(pulls, { reduced }), [pulls, reduced]);
  const images = usePulledImages(pulls);
  const [at, setAt] = useState(0);
  const [muted, setMuted] = useState(sfx.muted());
  const step = steps[at]!;
  const pull = step.index >= 0 ? pulls[step.index] : undefined;

  // Each step lasts its time; the scan waits until its image exists (or failed to); cards in a single scan wait.
  const imageSettled = step.kind !== 'scan' || images[step.index] !== undefined;
  useEffect(() => {
    if (!Number.isFinite(step.ms) || !imageSettled) return;
    const timer = setTimeout(() => setAt((i) => Math.min(i + 1, steps.length - 1)), step.ms);
    return () => clearTimeout(timer);
  }, [at, step, steps.length, imageSettled]);

  useEffect(() => {
    if (step.kind === 'signal') sfx.clack();
    if (step.kind === 'card' && step.tier) sfx.chord(step.tier);
  }, [step]);

  const summary = step.kind === 'summary';
  const sorted = useMemo(() => [...pulls].sort((a, b) => TIERS.indexOf(b.tier) - TIERS.indexOf(a.tier)), [pulls]);
  const go = () => setAt((i) => advance(steps, i));
  const cardSize = Math.min(300, Math.round((globalThis.innerHeight || 800) * 0.42));

  return (
    <Dialog title={title} onClose={onClose} className="reveal-stage" hideTitle>
      <div className="stage-top">
        {summary ? <span /> : <span className="stage-progress">{copy.scanner.progress(step.index + 1, pulls.length)}</span>}
        <div className="stage-tools">
          <button
            type="button"
            className="lip iconbtn"
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
          {summary ? null : (
            <button type="button" className="lip pill" data-autofocus onClick={() => setAt(skipToSummary(steps))}>
              {copy.scanner.skip}
            </button>
          )}
        </div>
      </div>

      {summary ? (
        <div className="stage-summary">
          <h3>{copy.scanner.summaryTitle(pulls.length)}</h3>
          <div className="summary-cards" data-count={pulls.length}>
            {sorted.map((g) => (
              <GalaxyCard key={g.id} galaxy={g} size={pulls.length > 1 ? 168 : 280} interactive />
            ))}
          </div>
          <div className="summary-actions">
            {actions}
            <button type="button" className="lip pill" data-autofocus onClick={onClose}>
              {copy.scanner.close}
            </button>
          </div>
        </div>
      ) : (
        <div className="crt" data-tier={step.tier} data-step={step.kind} data-reduced={reduced || undefined} onClick={go}>
          <div className="crt-screen">
            {step.kind === 'static' ? <Static still={reduced} /> : null}
            {step.kind === 'signal' ? (
              <span className="signal-step" aria-hidden="true">
                <span className="signal-bars" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((b) => (
                    <i key={b} data-on={b < (step.bars ?? 0) || undefined} style={{ '--b': b } as CSSProperties} />
                  ))}
                </span>
                <span className="signal-label">{copy.scanner.signal}</span>
              </span>
            ) : null}
            {step.kind === 'scan' || step.kind === 'phenomenon' || step.kind === 'glitch' ? <Scan canvas={images[step.index]} step={step} /> : null}
            {step.kind === 'phenomenon' ? (
              <span className="phenomenon">
                <b>{copy.scanner.phenomenon}</b>
                <span>{names[step.phenomenon ?? ''] ?? step.phenomenon}</span>
              </span>
            ) : null}
          </div>
          {/* The card pops out of the screen, over the bezel. */}
          {step.kind === 'card' && pull ? (
            <div className="stage-card" key={pull.id}>
              <GalaxyCard galaxy={pull} size={cardSize} interactive />
            </div>
          ) : null}
        </div>
      )}
      {summary ? null : (
        <button type="button" className="lip pill stage-next" onClick={go}>
          {copy.scanner.next}
        </button>
      )}
      <p className="sr-only" aria-live="polite">
        {step.kind === 'card' && pull ? copy.scanner.found(copy.tiers[pull.tier], pull.name) : ''}
      </p>
    </Dialog>
  );
}
