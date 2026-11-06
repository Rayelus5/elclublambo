import { useEffect, useRef } from 'react';
import { startScene } from './scene';

/**
 * Full-viewport living backdrop. The 1600×900 scene is scaled to COVER the window (wide screens see more sky, never
 * a letterbox), centered; the UI floats above it anchored to the edges.
 */
export function AuthBackdrop() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const arms = useRef<HTMLPreElement>(null);
  const core = useRef<HTMLPreElement>(null);
  const glitch = useRef<HTMLPreElement>(null);
  const scan = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const fit = () => {
      const s = Math.max(window.innerWidth / 1600, window.innerHeight / 900);
      wrap.current?.style.setProperty('--scene-scale', String(s));
    };
    fit();
    window.addEventListener('resize', fit);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const stop =
      canvas.current && arms.current && core.current && glitch.current && scan.current
        ? startScene({ canvas: canvas.current, arms: arms.current, core: core.current, glitch: glitch.current, scan: scan.current }, { reduce })
        : () => {};
    return () => {
      window.removeEventListener('resize', fit);
      stop();
    };
  }, []);

  return (
    <div className="backdrop" aria-hidden="true">
      <div className="scene" ref={wrap}>
        <canvas ref={canvas} width={400} height={225} />
        <div className="galaxy">
          <pre className="arms" ref={arms} />
          <pre className="core" ref={core} />
          <pre className="glitch" ref={glitch} />
          <pre className="scan" ref={scan} />
        </div>
      </div>
      <div className="vignette" />
    </div>
  );
}
