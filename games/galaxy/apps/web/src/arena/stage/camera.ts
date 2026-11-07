// The arena camera (GDD §17.2, DESIGN_SYSTEM §8 quater): a whole-number zoom so every sprite pixel is a square of
// screen pixels, about 340 world units of height on any monitor, and at most 21:9 of width. Wider screens get side
// bars, never more of the field.

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

export function cameraFor(viewportW: number, viewportH: number, focus: { x: number; y: number }, vision: number): Camera {
  const zoom = Math.max(1, Math.round(viewportH / (VIEW_HEIGHT * (1 + Math.max(0, vision)))));
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
