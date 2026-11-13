import { angleTo, type ProbeInput } from '@galaxy/sim';

// Controls (GDD §5.2): WASD or the arrows, a gamepad's left stick with a dead zone, and optional manual aim with the
// mouse or the right stick. Analog input is quantised (16 directions × 2 speeds, 64 aim directions) so a player's
// recorded log stays small and replays exactly. The dash (SIM 1.12.0): SHIFT or Space, or the pad's A or RB.

/** The keys that ask for a dash (e.code), and the pad's buttons (standard mapping: A, RB). */
export const DASH_KEYS: readonly string[] = ['ShiftLeft', 'ShiftRight', 'Space'];
export const DASH_BUTTONS: readonly number[] = [0, 5];
/**
 * A dash asked for during the short pause between two (up to this many ticks before it ends, half a second) waits for
 * it instead of being lost: it goes out on the tick the pause ends.
 */
export const DASH_BUFFER = 30;

/**
 * Whether a dash asked for now should wait (true) or go with the next tick, from the probe's dash: it waits only within
 * DASH_BUFFER of the end of the pause and with a charge ready (otherwise it goes, and the sim refuses it).
 */
export function dashWaits(d: { charges: number; pause: number } | undefined): boolean {
  return !!d && d.charges > 0 && d.pause > 1 && d.pause <= DASH_BUFFER + 1;
}

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

/**
 * Where the player points from the probe on screen (`from`): the right stick when pushed, else the mouse; a quantised
 * angle step, or −1 when nowhere. A dash standing still goes there.
 */
export function pointerAngle(s: InputState, from?: { x: number; y: number }): number {
  if (s.pad && Math.hypot(s.pad.rx, s.pad.ry) > 0.4) return quantiseAim(angleTo(s.pad.rx, s.pad.ry));
  if (s.mouse && from && (s.mouse.x !== from.x || s.mouse.y !== from.y)) return quantiseAim(angleTo(s.mouse.x - from.x, s.mouse.y - from.y));
  return -1;
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
  const aim = settings.manualAim ? pointerAngle(s, aimFrom) : -1;
  return { mx: mx === 0 ? 0 : mx, my: my === 0 ? 0 : my, aim, pick: -1 };
}
