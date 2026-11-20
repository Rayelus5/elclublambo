// Whether this browser can make a WebGL2 context (the 3D inspector, the pro scanner): probed once, then remembered.
// The probe gives its context back at once (browsers cap how many live at the same time). jsdom has none.

let known: boolean | null = null;

/** Probes now (the inspector, opened rarely, asks each time). */
export function probeWebGL2(): boolean {
  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    probe?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!probe;
  } catch {
    return false;
  }
}

/** Probed once and remembered (the scanner asks on every render). */
export function hasWebGL2(): boolean {
  known ??= probeWebGL2();
  return known;
}

/** Tests only: probe again. */
export function forgetWebGL2() {
  known = null;
}
