// A tab left open for days survives deploys (galaxysurvivor.es plan, PR 3): its next screen asks for a chunk the new
// build no longer has, and Vite fires `vite:preloadError`. One reload brings the new build. At most once a minute,
// remembered for the tab in sessionStorage, so a chunk that is really broken never turns into a reload loop (and with
// no sessionStorage there is no reload at all).

const KEY = 'galaxy.preload.reloaded';
const MIN_GAP_MS = 60_000;

export interface PreloadOptions {
  now?: () => number;
  reload?: () => void;
}

/** Starts listening for chunks that failed to load; returns the stop. */
export function watchPreloadErrors(win: Window = window, opts: PreloadOptions = {}): () => void {
  const now = opts.now ?? (() => Date.now());
  const reload = opts.reload ?? (() => win.location.reload());
  const onError = (event: Event) => {
    let last = 0;
    try {
      last = Number(win.sessionStorage.getItem(KEY)) || 0;
      if (now() - last < MIN_GAP_MS) return;
      win.sessionStorage.setItem(KEY, String(now()));
    } catch {
      return;
    }
    // Handled: the reload brings the new build instead of the error.
    event.preventDefault();
    reload();
  };
  win.addEventListener('vite:preloadError', onError);
  return () => win.removeEventListener('vite:preloadError', onError);
}
