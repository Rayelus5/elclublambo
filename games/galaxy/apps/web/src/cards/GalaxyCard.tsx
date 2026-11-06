import type { Lod } from '@galaxy/engine';
import type { PulledGalaxy } from '@galaxy/shared';
import { useEffect, useId, useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { copy } from '../copy/es';
import { useReducedMotion } from '../ui/motion';
import { useGalaxyImage } from './useGalaxyImage';

// A galaxy as a trading card (GDD §8.1, DESIGN_SYSTEM §7): the engine image in a frame of its tier's colour, the level,
// the name plate and its finish's effect. Interactive cards tilt towards the pointer in CSS 3D with a glare that
// follows it; with reduced motion they stay flat. The image loads only near the screen (useGalaxyImage).
const MAX_TILT = 11;

type CardGalaxy = PulledGalaxy & { level?: number };

function tilt(el: HTMLElement, x: number, y: number): void {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return;
  const px = Math.min(1, Math.max(0, (x - r.left) / r.width));
  const py = Math.min(1, Math.max(0, (y - r.top) / r.height));
  el.style.setProperty('--ry', `${((px - 0.5) * 2 * MAX_TILT).toFixed(2)}deg`);
  el.style.setProperty('--rx', `${((0.5 - py) * 2 * MAX_TILT).toFixed(2)}deg`);
  el.style.setProperty('--mx', `${Math.round(px * 100)}%`);
  el.style.setProperty('--my', `${Math.round(py * 100)}%`);
  el.style.setProperty('--angle', `${Math.round((px + py) * 180)}deg`);
  el.dataset['active'] = 'true';
}

function untilt(el: HTMLElement): void {
  el.style.setProperty('--ry', '0deg');
  el.style.setProperty('--rx', '0deg');
  el.style.setProperty('--mx', '50%');
  el.style.setProperty('--my', '50%');
  el.style.setProperty('--angle', '0deg');
  delete el.dataset['active'];
}

export function GalaxyCard({
  galaxy,
  size = 200,
  interactive = false,
  columns = 96,
  children,
}: {
  galaxy: CardGalaxy;
  /** An action laid over the whole card (a link or a toggle): inside the tilt, so the card still follows the pointer. */
  children?: ReactNode;
  /** Card width in CSS pixels (the height follows at 7:5). */
  size?: number;
  interactive?: boolean;
  columns?: Lod;
}) {
  const nameId = useId();
  const reduced = useReducedMotion();
  const { ref, canvas, state } = useGalaxyImage(galaxy.seed, columns, size);
  const art = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = art.current;
    if (!host || !canvas) return;
    host.prepend(canvas);
    return () => canvas.remove();
  }, [canvas]);

  const follow = interactive && !reduced;
  return (
    <article
      ref={ref}
      className="gcard"
      data-tier={galaxy.tier}
      data-finish={galaxy.finish}
      data-image={state}
      aria-labelledby={nameId}
      style={{ '--w': `${size}px` } as CSSProperties}
    >
      <div
        className="gcard-tilt"
        onPointerMove={follow ? (e: PointerEvent<HTMLDivElement>) => tilt(e.currentTarget, e.clientX, e.clientY) : undefined}
        onPointerLeave={follow ? (e: PointerEvent<HTMLDivElement>) => untilt(e.currentTarget) : undefined}
      >
        <div className="gcard-face">
          <div className="gcard-art" ref={art}>
            {state === 'ready' ? null : (
              <span className="gcard-wait" aria-hidden="true">
                {state === 'error' ? '⠿' : '⠋⠙⠹'}
              </span>
            )}
          </div>
          <div className="gcard-top">
            <span className="gcard-level">
              <span aria-hidden="true">{copy.card.levelShort(galaxy.level ?? 1)}</span>
              <span className="sr-only">{copy.card.level(galaxy.level ?? 1)}</span>
            </span>
            {galaxy.finish === 'normal' ? null : <span className="gcard-finish">{copy.finishes[galaxy.finish]}</span>}
          </div>
          <div className="gcard-plate">
            <b id={nameId}>{galaxy.name}</b>
            <span className="gcard-desig">{galaxy.designation}</span>
            <span className="gcard-tier">
              <i aria-hidden="true" />
              {copy.tiers[galaxy.tier]}
              {galaxy.featured ? <span className="gcard-featured">{copy.card.featured}</span> : null}
            </span>
          </div>
          <div className="gcard-fx" aria-hidden="true" />
          <div className="gcard-glare" aria-hidden="true" />
        </div>
        {children}
      </div>
    </article>
  );
}
