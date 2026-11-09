import { useEffect, useRef } from 'react';

/**
 * A moment of triumph over whatever it covers (a probe levelling up in the workshop, a galaxy in the collection):
 * sparks burst from below the middle, a ring of light, and a banner with what happened. Its parent removes it after
 * a while (2.6 s fits the banner). Reduced motion: the banner alone. `hot` and `cold` tint the sparks.
 */
export function Celebration({ title, subtitle, reduced, hot = ['#fff8e0', '#ffc94a'], cold = '#6fe3ff' }: { title: string; subtitle: string; reduced: boolean; hot?: [string, string]; cold?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (reduced) return;
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const w = (c.width = c.clientWidth);
    const h = (c.height = c.clientHeight);
    const sparks = Array.from({ length: 90 }, () => {
      const a = Math.random() * Math.PI * 2;
      const s = 120 + Math.random() * 360;
      return { x: w / 2, y: h * 0.55, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120, life: 0, max: 0.5 + Math.random() * 0.7, hot: Math.random() < 0.6 };
    });
    let last = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, w, h);
      let alive = 0;
      for (const s of sparks) {
        s.life += dt;
        if (s.life > s.max) continue;
        alive++;
        s.vy += 520 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        const k = 1 - s.life / s.max;
        ctx.globalAlpha = k;
        ctx.fillStyle = s.hot ? (k > 0.6 ? hot[0] : hot[1]) : cold;
        ctx.fillRect(Math.round(s.x), Math.round(s.y), 3, 3);
      }
      if (alive) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // The colours are read once, when it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);
  return (
    <div className="celebrate" role="status">
      <span className="celebrate-flash" aria-hidden="true" />
      <canvas ref={canvas} className="celebrate-sparks" aria-hidden="true" />
      <span className="celebrate-banner">
        <b>{title}</b>
        <small>{subtitle}</small>
      </span>
    </div>
  );
}
