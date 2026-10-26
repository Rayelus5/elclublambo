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

/** Is this one of the homes where the intro lives (/, /en, with or without a trailing slash)? */
export function isIntroPath(pathname: string): boolean {
  return (INTRO_PATHS as readonly string[]).includes(normalise(pathname));
}

export function shouldShowIntro(i: { pathname: string; seen: boolean; reducedMotion: boolean }): boolean {
  if (i.seen || i.reducedMotion) return false;
  return isIntroPath(i.pathname);
}

declare global {
  interface Window {
    /** A press on the overlay that the boot script caught before <IntroGate> hydrated. */
    __elclubIntro?: { x: number; y: number };
    /** Detaches the boot script's early pointerdown listener. */
    __elclubIntroOff?: () => void;
  }
}

/**
 * Source of the inline boot script: the same rule as shouldShowIntro, self-contained. A throwing localStorage (blocked
 * private mode) counts as "not seen": the intro shows and can be passed, it just is not remembered. With reduced motion
 * the intro does not show and the visit counts as made (spec).
 *
 * The overlay paints with the HTML but its handlers only exist once the bundle hydrates (1–3 s on a phone on mobile
 * data): when the intro shows, a capture pointerdown listener records the first primary press on the overlay (not on a
 * link, «Saltar» is one) in window.__elclubIntro and removes itself. <IntroGate> detaches it with
 * window.__elclubIntroOff and replays that press (takeEarlyTap).
 */
export function introBootScript(): string {
  const key = JSON.stringify(INTRO_KEY);
  return `(function(){try{var p=location.pathname;if(p.length>1&&p.charAt(p.length-1)==="/")p=p.slice(0,-1);if(${JSON.stringify(
    INTRO_PATHS,
  )}.indexOf(p)<0)return;var s=false;try{s=localStorage.getItem(${key})==="1"}catch(e){}if(s)return;if(typeof matchMedia==="function"&&matchMedia("(prefers-reduced-motion: reduce)").matches){try{localStorage.setItem(${key},"1")}catch(e){}return}var d=document;d.documentElement.dataset.intro="on";var off=function(){d.removeEventListener("pointerdown",early,true)};function early(e){var t=e.target;if(e.button!==0||!t||!t.closest||!t.closest("[data-intro-overlay]")||t.closest("a"))return;window.__elclubIntro={x:e.clientX,y:e.clientY};off()}d.addEventListener("pointerdown",early,true);window.__elclubIntroOff=off}catch(e){}})();`;
}

/** Detaches the boot script's early listener and returns (once) the press it caught before hydration, if any. */
export function takeEarlyTap(): { x: number; y: number } | null {
  const w = window;
  const off = w.__elclubIntroOff;
  delete w.__elclubIntroOff;
  try {
    off?.();
  } catch {
    // Nothing to detach.
  }
  const tap = w.__elclubIntro ?? null;
  delete w.__elclubIntro;
  return tap;
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
