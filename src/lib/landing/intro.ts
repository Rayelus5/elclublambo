/*
 * First-visit intro of the public home (/ and /en). Pure logic shared by the inline boot script (which decides, before
 * the first paint, whether the overlay shows) and by <IntroGate> (which plays it).
 *
 * DOM contract (CSS in globals.css, e2e in Task 4):
 * - html[data-intro="on"]: overlay visible, scroll locked, the hero's CSS rises paused.
 * - html[data-intro="revealing"]: the tile wave is uncovering the landing; the rises play.
 * - no attribute: no overlay.
 */

/** Shared by / and /en: entering through one home counts for the other. */
export const INTRO_KEY = "elclub-intro-seen";
export const INTRO_PATHS = ["/", "/en"] as const;

function normalise(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export function shouldShowIntro(i: { pathname: string; seen: boolean; reducedMotion: boolean }): boolean {
  if (i.seen || i.reducedMotion) return false;
  return (INTRO_PATHS as readonly string[]).includes(normalise(i.pathname));
}

/**
 * Source of the inline boot script: the same rule as shouldShowIntro, self-contained. A throwing localStorage (blocked
 * private mode) counts as "not seen": the intro shows and can be passed, it just is not remembered.
 */
export function introBootScript(): string {
  return `(function(){try{var p=location.pathname;if(p.length>1&&p.charAt(p.length-1)==="/")p=p.slice(0,-1);if(${JSON.stringify(
    INTRO_PATHS,
  )}.indexOf(p)<0)return;var s=false;try{s=localStorage.getItem(${JSON.stringify(
    INTRO_KEY,
  )})==="1"}catch(e){}if(s)return;if(typeof matchMedia==="function"&&matchMedia("(prefers-reduced-motion: reduce)").matches)return;document.documentElement.dataset.intro="on"}catch(e){}})();`;
}

/** Remembers the visit. Never throws: a blocked storage only means the intro shows again next time. */
export function markIntroSeen(storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? window.localStorage).setItem(INTRO_KEY, "1");
  } catch {
    // Blocked storage: nothing to remember.
  }
}

/** About 12 columns on desktop and 6 on mobile; rows follow the viewport's aspect ratio. */
export function gridFor(width: number, height: number): { cols: number; rows: number } {
  const cols = width >= 768 ? 12 : 6;
  return { cols, rows: Math.max(1, Math.round((cols * height) / width)) };
}

/** Row-major delay of each tile: its centre's distance to the origin (where the visitor pressed) times msPerPx. */
export function waveDelays(
  g: { cols: number; rows: number },
  size: { width: number; height: number },
  origin: { x: number; y: number },
  msPerPx = 1.6,
): number[] {
  const tw = size.width / g.cols;
  const th = size.height / g.rows;
  const out: number[] = [];
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      out.push(Math.hypot(c * tw + tw / 2 - origin.x, r * th + th / 2 - origin.y) * msPerPx);
    }
  }
  return out;
}
