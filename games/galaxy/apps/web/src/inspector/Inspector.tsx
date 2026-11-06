import type { PulledGalaxy } from '@galaxy/shared';
import { useEffect, useRef, useState } from 'react';
import { CardBack } from '../cards/CardBack';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { composeInto } from '../galaxy/compose';
import { loadRender } from '../galaxy/images';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../ui/motion';
import type { InspectorScene } from './inspector-scene';
import { drawBack, drawFront, drawMask, drawStarfield } from './textures';

// The 3D inspector (GDD §8.1): the card up close in three.js — layers in depth, parallax with the pointer, the
// finish's own light and a turn to see the back. three.js is imported only here, when it opens (its own chunk), and
// closing gives the WebGL context back. Without WebGL2 (or if anything fails) the flat card shows, front and back.
type Mode = 'loading' | 'ready' | 'flat';

function hasWebGL2(): boolean {
  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    probe?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!probe;
  } catch {
    return false;
  }
}

export function Inspector({ galaxy, onClose }: { galaxy: PulledGalaxy & { level?: number }; onClose: () => void }) {
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<Mode>(() => (hasWebGL2() ? 'loading' : 'flat'));
  const [back, setBack] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<InspectorScene | null>(null);
  const webgl = mode !== 'flat';

  useEffect(() => {
    const el = canvas.current;
    if (!webgl || !el) return;
    const controller = new AbortController();
    const seed = BigInt(galaxy.seed);
    (async () => {
      try {
        const [module, front, braille] = await Promise.all([
          import('./inspector-scene'),
          loadRender(seed, 192, controller.signal),
          loadRender(seed, 48, controller.signal),
          document.fonts?.ready,
        ]);
        if (controller.signal.aborted) return;
        const image = document.createElement('canvas');
        if (!composeInto(image, front, 1024)) throw new Error('compose');
        scene.current = module.createInspectorScene(el, {
          front: drawFront(galaxy),
          back: drawBack(galaxy, braille.text),
          galaxy: image,
          starfield: drawStarfield(galaxy.seed),
          mask: drawMask(),
          finish: galaxy.finish,
          reduced,
        });
        setMode('ready');
      } catch {
        if (!controller.signal.aborted) setMode('flat');
      }
    })();
    return () => {
      controller.abort();
      scene.current?.dispose();
      scene.current = null;
    };
  }, [webgl, galaxy, reduced]);

  useEffect(() => scene.current?.flip(back), [back, mode]);

  return (
    <Dialog title={copy.inspector.title(galaxy.name)} onClose={onClose} className="inspector-dialog">
      <div className="inspector" data-state={mode} data-finish={galaxy.finish} data-tier={galaxy.tier}>
        {webgl ? (
          <>
            <canvas ref={canvas} className="inspector-gl" aria-label={copy.inspector.canvas(galaxy.name)} role="img" />
            {mode === 'loading' ? (
              <span className="inspector-wait" aria-hidden="true">
                ⠋⠙⠹
              </span>
            ) : null}
          </>
        ) : (
          <div className="inspector-flat">
            <p>{copy.inspector.flat}</p>
            <div>
              <GalaxyCard galaxy={galaxy} size={260} interactive />
              <CardBack galaxy={galaxy} size={260} />
            </div>
          </div>
        )}
      </div>
      <div className="inspector-actions">
        {webgl ? (
          <>
            <span className="inspector-hint">{copy.inspector.hint}</span>
            <button type="button" className="lip pill" aria-pressed={back} disabled={mode !== 'ready'} onClick={() => setBack((b) => !b)}>
              <Icon name="flip" />
              <span>{back ? copy.inspector.front : copy.inspector.back}</span>
            </button>
          </>
        ) : null}
        <button type="button" className="lip pill" data-autofocus onClick={onClose}>
          {copy.collection.close}
        </button>
      </div>
    </Dialog>
  );
}
