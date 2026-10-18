// The thread panel's width on desktop, remembered per browser (a convenience: storage may be unavailable).
const KEY = "elclub:thread-width";

/** Neither the thread nor the channel beside it gets narrower than this. */
export const THREAD_MIN = 320;
export const THREAD_DEFAULT = 384;

/** Keeps the thread between THREAD_MIN and what still leaves the channel THREAD_MIN wide. */
export function clampThreadWidth(width: number, containerWidth: number): number {
  const max = Math.max(THREAD_MIN, containerWidth - THREAD_MIN);
  return Math.round(Math.min(Math.max(width, THREAD_MIN), max));
}

export function loadThreadWidth(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n >= THREAD_MIN ? n : THREAD_DEFAULT;
  } catch {
    return THREAD_DEFAULT;
  }
}

export function saveThreadWidth(width: number): void {
  try {
    localStorage.setItem(KEY, String(Math.round(width)));
  } catch {
    // private window / blocked storage: the width just isn't remembered
  }
}
