import { type Tier } from '@galaxy/shared';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { burstFor, type Burst, type Particle, stepParticles } from './fx';

// The reveal's burst on screen (open beta): one canvas over the whole page (outside the dialog, which clips), with
// the sparks, confetti and rings of `fx.ts`, a flash over everything from epic up (iridescent for a mythic), and a
// short shake of the dialog for a legendary or a mythic. Pixel-sharp (no smoothing). Nothing at all with reduced motion.

export interface FxTrigger {
  /** Changes with every card: the same id never bursts twice. */
  id: string;
  tier: Tier;
  seed: string;
}

export function RevealFx({ trigger, reduced }: { trigger: FxTrigger | null; reduced: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [flash, setFlash] = useState<{ key: string; strength: number; tier: Tier } | null>(null);

  useEffect(() => {
    if (!trigger || reduced || typeof window === 'undefined') return;
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    const burst: Burst = burstFor(trigger.tier, trigger.seed, w, h);
    // Flash and shake are separate layers; both run their own CSS animation.
    const show = burst.flash > 0 ? requestAnimationFrame(() => setFlash({ key: trigger.id, strength: burst.flash, tier: trigger.tier })) : 0;
    const stage = burst.shake ? document.querySelector('.modal.reveal-stage') : null;
    stage?.classList.add('shake');
    const unshake = stage ? setTimeout(() => stage.classList.remove('shake'), 480) : undefined;
    let ps: Particle[] = burst.particles;
    let elapsed = 0;
    let last = performance.now();
    let raf = 0;
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      elapsed += dt;
      ps = stepParticles(ps, dt);
      g.clearRect(0, 0, w, h);
      for (const ring of burst.rings) {
        const k = (elapsed - ring.delay) / ring.max;
        if (k < 0 || k > 1) continue;
        g.globalAlpha = (1 - k) * 0.9;
        g.strokeStyle = ring.color;
        g.lineWidth = Math.max(1, 8 * (1 - k));
        g.beginPath();
        g.arc(ring.x, ring.y, 30 + k * Math.max(w, h) * 0.38, 0, Math.PI * 2);
        g.stroke();
      }
      for (const p of ps) {
        g.globalAlpha = Math.max(0, 1 - p.life / p.max);
        g.fillStyle = p.color;
        if (p.kind === 'spark') {
          g.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
        } else {
          g.save();
          g.translate(Math.round(p.x), Math.round(p.y));
          g.rotate(p.rot);
          g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          g.restore();
        }
      }
      g.globalAlpha = 1;
      const ringsLeft = burst.rings.some((r) => elapsed < r.delay + r.max);
      if (ps.length > 0 || ringsLeft) raf = requestAnimationFrame(draw);
      else g.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(show);
      if (unshake) clearTimeout(unshake);
      stage?.classList.remove('shake');
      g.clearRect(0, 0, w, h);
    };
  }, [trigger, reduced]);

  if (reduced || typeof document === 'undefined') return null;
  return createPortal(
    <div className="reveal-fx" aria-hidden="true">
      <canvas ref={canvas} />
      {flash ? (
        <div
          key={flash.key}
          className="reveal-flash"
          data-tier={flash.tier}
          style={{ '--flash': flash.strength } as CSSProperties}
          onAnimationEnd={() => setFlash(null)}
        />
      ) : null}
    </div>,
    document.body,
  );
}
