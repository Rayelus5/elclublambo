import { COOP_MARKS, type CoopMark, type CoopPlayer } from '@galaxy/shared';
import type { CSSProperties } from 'react';
import type { Camera } from '../arena/stage/camera';
import { TEAM_TINT } from '../arena/stage/stage';
import { copy } from '../copy/es';

// Quick marks in a group run (multiplayer plan, phase 6c): a tap of Q marks «Aquí» where the pointer is; held, a wheel
// of four opens there (Aquí to the left, Ayuda up, A la baliza right, Cuidado down) and releasing Q towards one sends
// it. Every mark shows on everyone's screen for a few seconds in its player's colour, with their name; one off the
// screen sits on its edge with an arrow towards it.

const m = copy.coop.marks;
export const MARK_SHOW_MS = 4500;
/** How far the pointer must move from where Q was pressed to pick a direction of the wheel. */
const DEADZONE = 30;

export interface ShownMark {
  id: number;
  slot: number;
  kind: CoopMark;
  x: number;
  y: number;
  at: number;
}

/** The wheel's choice for a pointer moved (dx, dy) screen pixels from where Q went down. */
export function markFrom(dx: number, dy: number): CoopMark {
  if (Math.hypot(dx, dy) < DEADZONE) return 'here';
  if (Math.abs(dy) > Math.abs(dx)) return dy < 0 ? 'help' : 'danger';
  return dx > 0 ? 'beacon' : 'here';
}

/** A screen point to a world point, through the arena camera (the field is centred in the canvas). */
export function toWorld(cam: Camera, rect: { left: number; top: number; height: number }, p: { x: number; y: number }): { x: number; y: number } {
  return {
    x: cam.x + (p.x - rect.left - cam.bars - (cam.worldW * cam.zoom) / 2) / cam.zoom,
    y: cam.y + (p.y - rect.top - rect.height / 2) / cam.zoom,
  };
}

const POS: Record<CoopMark, string> = { here: 'left', help: 'up', beacon: 'right', danger: 'down' };

export function MarkWheel({ at, choice }: { at: { x: number; y: number }; choice: CoopMark }) {
  return (
    <div className="mark-wheel" role="menu" aria-label={m.wheel} style={{ left: `${Math.round(at.x)}px`, top: `${Math.round(at.y)}px` } as CSSProperties}>
      {COOP_MARKS.map((k) => (
        <span key={k} role="menuitemradio" aria-checked={choice === k} className={`mark-option ${POS[k]} k-${k}${choice === k ? ' on' : ''}`}>
          {m.kinds[k]}
        </span>
      ))}
    </div>
  );
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export function CoopMarks({ marks, camera, width, height, players, me }: { marks: ShownMark[]; camera: Camera | null; width: number; height: number; players: CoopPlayer[]; me: number }) {
  const zoom = camera?.zoom ?? 2;
  const bars = camera?.bars ?? 0;
  const fieldW = width - bars * 2;
  const cx = bars + fieldW / 2;
  const cy = height / 2;
  const pad = 48;
  return (
    <div className="coop-marks" aria-live="polite">
      {marks.map((k) => {
          const sx = cx + (k.x - (camera?.x ?? 0)) * zoom;
          const sy = cy + (k.y - (camera?.y ?? 0)) * zoom;
          const inside = sx > bars + pad && sx < width - bars - pad && sy > pad && sy < height - pad;
          let x = sx;
          let y = sy;
          let angle = 0;
          if (!inside) {
            angle = Math.atan2(sy - cy, sx - cx);
            const kx = (fieldW / 2 - pad) / Math.max(1e-6, Math.abs(Math.cos(angle)));
            const ky = (height / 2 - pad) / Math.max(1e-6, Math.abs(Math.sin(angle)));
            const r = Math.min(kx, ky);
            x = cx + Math.cos(angle) * r;
            y = cy + Math.sin(angle) * r;
          }
          const who = k.slot === me ? copy.coop.arena.you : (players[k.slot]?.username ?? '');
          return (
            <span
              key={k.id}
              className={`coop-mark k-${k.kind}${inside ? '' : ' edge'}`}
              role="img"
              aria-label={m.label(who, m.kinds[k.kind])}
              style={{ left: `${Math.round(x)}px`, top: `${Math.round(y)}px`, '--tint': hex(TEAM_TINT[k.slot] ?? 0xffffff) } as CSSProperties}
            >
              {inside ? <i className="coop-mark-pin" aria-hidden="true" /> : <i className="coop-mark-arrow" aria-hidden="true" style={{ transform: `rotate(${angle}rad)` }} />}
              <b aria-hidden="true">{m.kinds[k.kind]}</b>
              <small aria-hidden="true">{who}</small>
            </span>
          );
        })}
    </div>
  );
}
