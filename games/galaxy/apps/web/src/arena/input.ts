import { angleTo, type ProbeInput } from '@galaxy/sim';

// Controls (GDD §5.2): WASD or the arrows, a gamepad's left stick with a dead zone, and optional manual aim with the
// mouse or the right stick. Analog input is quantised (16 directions × 2 speeds, 64 aim directions) so a player's
// recorded log stays small and replays exactly.

export interface InputState {
  keys: Set<string>;
  pad: { x: number; y: number; rx: number; ry: number } | null;
  /** Mouse position in screen pixels. */
  mouse: { x: number; y: number } | null;
}

export function emptyInput(): InputState {
  return { keys: new Set(), pad: null, mouse: null };
}

const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const DEAD = 0.2;
const FULL = 0.6;

const any = (keys: Set<string>, list: string[]) => list.some((k) => keys.has(k));

function quantiseAim(a: number): number {
  return (Math.round(a / 64) * 64) % 4096;
}

export function readInput(s: InputState, settings: { manualAim: boolean }, aimFrom?: { x: number; y: number }): ProbeInput {
  let mx = (any(s.keys, RIGHT) ? 127 : 0) - (any(s.keys, LEFT) ? 127 : 0);
  let my = (any(s.keys, DOWN) ? 127 : 0) - (any(s.keys, UP) ? 127 : 0);
  if (mx === 0 && my === 0 && s.pad) {
    const len = Math.hypot(s.pad.x, s.pad.y);
    if (len >= DEAD) {
      const a = Math.round(Math.atan2(s.pad.y, s.pad.x) / (Math.PI / 8)) * (Math.PI / 8);
      const mag = len >= FULL ? 127 : 64;
      mx = Math.round(Math.cos(a) * mag);
      my = Math.round(Math.sin(a) * mag);
    }
  }
  let aim = -1;
  if (settings.manualAim) {
    if (s.pad && Math.hypot(s.pad.rx, s.pad.ry) > 0.4) aim = quantiseAim(angleTo(s.pad.rx, s.pad.ry));
    else if (s.mouse && aimFrom && (s.mouse.x !== aimFrom.x || s.mouse.y !== aimFrom.y)) aim = quantiseAim(angleTo(s.mouse.x - aimFrom.x, s.mouse.y - aimFrom.y));
  }
  return { mx: mx === 0 ? 0 : mx, my: my === 0 ? 0 : my, aim, pick: -1 };
}
