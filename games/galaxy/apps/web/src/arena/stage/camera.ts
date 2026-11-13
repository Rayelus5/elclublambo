// The arena camera (GDD §17.2, DESIGN_SYSTEM §8 quater): a whole-number zoom so every sprite pixel is a square of
// screen pixels, about 340 world units of height on any monitor, and at most 21:9 of width. Wider screens get side
// bars, never more of the field. The mouse wheel brings it closer (the owner's request, 2026-11-11), in whole steps up
// to twice as close; the base view is the widest there is. Only the drawing changes, never the simulation.

export const VIEW_HEIGHT = 340;
export const MAX_ASPECT = 21 / 9;

export interface Camera {
  zoom: number;
  /** Visible world size (units). */
  worldW: number;
  worldH: number;
  /** Top-left screen pixel of the field inside the canvas (bars on the sides). */
  bars: number;
  /** World point at the centre of the field, snapped to whole screen pixels. */
  x: number;
  y: number;
}

/** How much closer the wheel may bring the view: twice the base zoom at most. */
export const MAX_CLOSER = 2;

/** The base zoom of a viewport: whole, about VIEW_HEIGHT of world (less zoom with a relic's wider vision). */
export function baseZoom(viewportH: number, vision: number): number {
  return Math.max(1, Math.round(viewportH / (VIEW_HEIGHT * (1 + Math.max(0, vision)))));
}

/** How many whole steps closer than its base zoom the wheel can go. */
export function zoomSteps(base: number): number {
  return Math.max(1, Math.floor(base * MAX_CLOSER) - base);
}

/**
 * The camera for a viewport and a focus. `closer` is how many steps nearer than the base view (the wheel), kept within
 * its limits; between two steps it may be a fraction for a moment (the zoom's short glide).
 */
export function cameraFor(viewportW: number, viewportH: number, focus: { x: number; y: number }, vision: number, closer = 0): Camera {
  const base = baseZoom(viewportH, vision);
  const zoom = base + Math.min(Math.max(0, closer), zoomSteps(base));
  const worldH = viewportH / zoom;
  const worldW = Math.min(viewportW / zoom, worldH * MAX_ASPECT);
  const bars = Math.max(0, Math.round((viewportW - worldW * zoom) / 2));
  return {
    zoom,
    worldW,
    worldH,
    bars,
    x: Math.round(focus.x * zoom) / zoom,
    y: Math.round(focus.y * zoom) / zoom,
  };
}

/**
 * Wheel turns as zoom steps: a mouse notch is one (up comes closer); a trackpad's small deltas add up to one. With
 * SHIFT held (a dash) the browser turns the wheel sideways: its sideways delta zooms the same.
 */
export function wheelSteps(rest: number, e: { deltaY: number; deltaX?: number; shiftKey?: boolean; deltaMode: number }): { steps: number; rest: number } {
  const delta = e.deltaY === 0 && e.shiftKey ? (e.deltaX ?? 0) : e.deltaY;
  const total = rest + delta * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1);
  const whole = Math.trunc(total / 100);
  return { steps: whole === 0 ? 0 : -whole, rest: total - whole * 100 };
}
