import { PALETTES } from '@galaxy/engine';
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
import type { InspectorScene, InspectorVariant } from './inspector-scene';
import { drawBack, drawFront, drawMask, drawStarfield, featherGalaxy, glowGalaxy } from './textures';

// The 3D inspector (GDD §8.1): the card up close in three.js — layers in depth, parallax with the pointer, the
// finish's own light and a turn to see the back, with the button or by dragging the card sideways (M6d-1). three.js is imported only here, when it opens (its own chunk), and
// closing gives the WebGL context back. A computer that cannot make the pro view gets the classic one (the layers as
// they were before M6d-1), and without WebGL2 (or if that fails too) the flat card shows, front and back; both say
// why, concretely (the owner's request).
type Mode = 'loading' | 'ready' | 'flat';

/** Why a view could not be made, in the player's words: the cause when it is known, the error's own words otherwise. */
function reasonOf(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/webgl|context/i.test(message)) return copy.inspector.reasons.context;
  return copy.inspector.reasons.other(message.slice(0, 120));
}

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
  const [gl] = useState(hasWebGL2);
  const [mode, setMode] = useState<Mode>(gl ? 'loading' : 'flat');
  const [variant, setVariant] = useState<InspectorVariant>('pro');
  const [reason, setReason] = useState<string | null>(gl ? null : copy.inspector.reasons.noWebgl2);
  const [back, setBack] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<InspectorScene | null>(null);
  const webgl = mode !== 'flat';

  useEffect(() => {
    const el = canvas.current;
    if (!webgl || !el) return;
    const controller = new AbortController();
    const seed = BigInt(galaxy.seed);
    const flat = (why: string) => {
      if (controller.signal.aborted) return;
      setReason(why);
      setMode('flat');
    };
    (async () => {
      let module: typeof import('./inspector-scene');
      let front: Awaited<ReturnType<typeof loadRender>>;
      let braille: Awaited<ReturnType<typeof loadRender>>;
      const image = document.createElement('canvas');
      try {
        [module, front, braille] = await Promise.all([import('./inspector-scene'), loadRender(seed, 192, controller.signal), loadRender(seed, 48, controller.signal), document.fonts?.ready]);
        if (controller.signal.aborted) return;
        if (!composeInto(image, front, 1024)) throw new Error('compose');
      } catch {
        flat(copy.inspector.reasons.render);
        return;
      }
      const inverted = PALETTES.get(galaxy.traits['palette'] ?? '')?.mode === 'inverted';
      const common = { front: drawFront(galaxy), back: drawBack(galaxy, braille.text), starfield: drawStarfield(galaxy.seed), mask: drawMask(), finish: galaxy.finish, reduced, inverted };
      // A drag that leaves the other face showing turns the button with it.
      const events = { onFace: (face: 'front' | 'back') => setBack(face === 'back') };
      let why: string;
      try {
        scene.current = module.createInspectorScene(el, { ...common, galaxy: featherGalaxy(image), glow: glowGalaxy(image) }, events, 'pro');
        setVariant('pro');
        setMode('ready');
        return;
      } catch (err) {
        why = reasonOf(err);
      }
      if (controller.signal.aborted) return;
      try {
        // An inverted galaxy is an image, not light: feathered, or its square would show (InspectorFaces.inverted).
        scene.current = module.createInspectorScene(el, { ...common, galaxy: inverted ? featherGalaxy(image) : image }, events, 'classic');
        setVariant('classic');
        setReason(why);
        setMode('ready');
      } catch (err) {
        flat(reasonOf(err));
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
      {reason && (mode === 'flat' || variant === 'classic') ? (
        <p className="inspector-notice" role="note">
          <Icon name="alert" />
          <span>
            {mode === 'flat' ? copy.inspector.flat : copy.inspector.proUnavailable}. {copy.inspector.reason(reason)}
          </span>
        </p>
      ) : null}
      <div className="inspector" data-state={mode} data-variant={mode === 'flat' ? undefined : variant} data-finish={galaxy.finish} data-tier={galaxy.tier}>
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
