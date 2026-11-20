import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';

// What the game's own popups share (C1: the dropdown of ui/Select.tsx and the calendar of ui/DateField.tsx). They live
// in a portal on <body> with `position: fixed`, so no scrolling panel or dialog clips them, and they are placed from
// their anchor through the CSSOM (the CSP has no inline styles): below it, or above when there is more room there,
// inside the window, with the CSS zoom of the large screens carried over.

/** Gap between the anchor and the popup, and the margin kept from the window's edges (px). */
const GAP = 6;
const EDGE = 8;

/** How a popup sits by its anchor. */
export interface Placement {
  /** Its tallest size: beyond it, it scrolls inside. */
  maxHeight: number;
  /** A list is at least as wide as its trigger; a calendar keeps its own width. */
  matchWidth?: boolean;
  /** Its left edge under the anchor's (`start`) or its right edge under the anchor's right (`end`). */
  align?: 'start' | 'end';
  /** When it fits on neither side, it moves over its anchor to be seen whole (a calendar should not scroll). */
  cover?: boolean;
}

/** Places `pop` beside `anchor` as `how` says. False when the anchor has left the window. */
export function placePopup(anchor: HTMLElement, pop: HTMLElement, how: Placement): boolean {
  const { maxHeight, matchWidth = true, align = 'start', cover = false } = how;
  const r = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return false;
  // A zoomed screen (the large ones) draws the anchor bigger than its own size: the popup takes the same zoom.
  const z = anchor.offsetWidth > 0 && r.width > 0 ? r.width / anchor.offsetWidth : 1;
  const s = pop.style;
  s.setProperty('zoom', Math.abs(z - 1) < 0.01 ? '' : String(z));
  s.minWidth = matchWidth ? `${r.width / z}px` : '';
  s.maxWidth = `${(vw - 2 * EDGE) / z}px`;
  s.maxHeight = '';
  const natural = pop.offsetHeight * z;
  const width = pop.offsetWidth * z;
  const below = vh - r.bottom - GAP * z - EDGE;
  const above = r.top - GAP * z - EDGE;
  const want = Math.min(natural, maxHeight * z);
  const down = below >= want || below >= above;
  let height = Math.max(0, Math.min(want, down ? below : above));
  let top = down ? r.bottom + GAP * z : r.top - GAP * z - height;
  if (cover && height < want) {
    height = Math.min(want, vh - 2 * EDGE);
    top = Math.max(EDGE, Math.min(top, vh - EDGE - height));
  }
  const left = Math.max(EDGE, Math.min(align === 'end' ? r.right - width : r.left, vw - EDGE - width));
  s.maxHeight = `${height / z}px`;
  s.top = `${top / z}px`;
  s.left = `${left / z}px`;
  pop.dataset['side'] = down ? 'bottom' : 'top';
  return true;
}

/**
 * While `open`, keeps `pop` placed beside `anchor`: before the first paint, then whenever anything scrolls (except the
 * popup itself), the window changes size or the anchor finishes a transition. `onLost` runs when the anchor leaves
 * the window. `key` places it again when what it shows changes size.
 */
export function useFollowAnchor(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  pop: RefObject<HTMLElement | null>,
  how: Placement,
  onLost: () => void,
  key: unknown = null,
): void {
  const { maxHeight, matchWidth, align, cover } = how;
  const lost = useRef(onLost);
  useLayoutEffect(() => {
    lost.current = onLost;
  });
  useLayoutEffect(() => {
    const a = anchor.current;
    const p = pop.current;
    if (!open || !a || !p) return;
    const place = () => placePopup(a, p, { maxHeight, matchWidth, align, cover });
    place();
    let frame = 0;
    const follow = (e: Event) => {
      if (e.target instanceof Node && p.contains(e.target)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!place()) lost.current();
      });
    };
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    // A pressed anchor settles after the click that opened its popup.
    a.addEventListener('transitionend', follow);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
      a.removeEventListener('transitionend', follow);
    };
  }, [open, anchor, pop, maxHeight, matchWidth, align, cover, key]);
}

/** While `open`, a press outside every element of `inside` runs `onOutside` (it closes the popup without choosing). */
export function useOutsidePress(open: boolean, inside: readonly RefObject<HTMLElement | null>[], onOutside: () => void): void {
  const outside = useRef(onOutside);
  const within = useRef(inside);
  useLayoutEffect(() => {
    outside.current = onOutside;
    within.current = inside;
  });
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && within.current.some((r) => r.current?.contains(target))) return;
      outside.current();
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open]);
}
