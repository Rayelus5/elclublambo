/** Interface scale chosen in the profile. Per device (localStorage), applied with CSS `zoom` on <html>. */
export const UI_ZOOM_KEY = "ecl-ui-zoom";
export const UI_ZOOM_LEVELS = [0.8, 0.9, 1, 1.1, 1.25] as const;
export type UiZoom = (typeof UI_ZOOM_LEVELS)[number];

export function isUiZoom(value: unknown): value is UiZoom {
  return UI_ZOOM_LEVELS.includes(Number(value) as UiZoom);
}

/** Inline boot script for <head>: applies the stored scale before first paint (no flash). */
export const UI_ZOOM_BOOT = `try{var z=Number(localStorage.getItem(${JSON.stringify(UI_ZOOM_KEY)}));if([${UI_ZOOM_LEVELS.join(",")}].indexOf(z)>-1&&z!==1)document.documentElement.style.zoom=String(z)}catch(e){}`;

export function applyUiZoom(zoom: UiZoom) {
  document.documentElement.style.zoom = zoom === 1 ? "" : String(zoom);
  try {
    if (zoom === 1) localStorage.removeItem(UI_ZOOM_KEY);
    else localStorage.setItem(UI_ZOOM_KEY, String(zoom));
  } catch {
    // Storage blocked: the scale still applies until reload.
  }
}

export function readUiZoom(): UiZoom {
  try {
    const stored = Number(localStorage.getItem(UI_ZOOM_KEY));
    return isUiZoom(stored) ? stored : 1;
  } catch {
    return 1;
  }
}
