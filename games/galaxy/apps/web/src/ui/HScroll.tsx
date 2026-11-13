import { createElement, type HTMLAttributes, type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { copy } from '../copy/es';
import { Icon } from './Icon';
import { useReducedMotion } from './motion';

// What scrolls sideways (the owner's request, 2026-11-11): the game shows no scrollbars anywhere, so a strip wider than
// its place gets arrows at the side where there is more, fades at that edge, and takes the mouse wheel (a vertical turn
// moves it sideways until it reaches its end; then the page scrolls as always). Tables keep the wheel for the page and
// show their arrows at the top. Fingers, trackpads and the keyboard scroll it natively.

export interface Edges {
  /** At the start: nothing more to the left. */
  start: boolean;
  /** At the end: nothing more to the right. */
  end: boolean;
}

/** The wheel moves `ref` sideways while it can (a vertical turn included); at its ends the page takes the wheel. */
export function useWheelSideways(ref: RefObject<HTMLElement | null>, on = true): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || el.scrollWidth <= el.clientWidth + 1) return;
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!raw) return;
      const d = raw * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1);
      const max = el.scrollWidth - el.clientWidth;
      if ((d < 0 && el.scrollLeft <= 0) || (d > 0 && el.scrollLeft >= max - 1)) return;
      e.preventDefault();
      el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + d));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [ref, on]);
}

/** Where `ref` is in its sideways scroll, kept up to date as it scrolls, resizes or changes. */
export function useEdges(ref: RefObject<HTMLElement | null>): [Edges, () => void] {
  const [edges, setEdges] = useState<Edges>({ start: true, end: true });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft <= 4;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
  }, [ref]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    resize?.observe(el);
    const changes = typeof MutationObserver === 'function' ? new MutationObserver(measure) : null;
    changes?.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener('scroll', measure);
      resize?.disconnect();
      changes?.disconnect();
    };
  }, [ref, measure]);
  return [edges, measure];
}

type Props = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  /** The element that scrolls (its list semantics stay): `div`, `ol` or `ul`. */
  as?: 'div' | 'ol' | 'ul';
  /**
   * `table` keeps the wheel for the page and puts the arrows at the top. Its class is `hscroll-table`, never `table`:
   * that one is Tailwind's utility (display: table), which made the frame grow with a wide table instead of scrolling.
   */
  variant?: 'strip' | 'table';
  /** What scrolls, for the arrows' names («Reliquias: ver más»). */
  label?: string;
  children: ReactNode;
};

/** A sideways strip with no scrollbar: arrows where there is more, faded edges and the mouse wheel. */
export function HScroll({ as = 'div', variant = 'strip', label, className, children, ...rest }: Props) {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const [edges] = useEdges(ref);
  useWheelSideways(ref, variant === 'strip');
  const slide = (dir: 1 | -1) => {
    const el = ref.current;
    el?.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.8), behavior: reduced ? 'auto' : 'smooth' });
  };
  const t = copy.scroll;
  return (
    <div className={`hscroll ${variant === 'table' ? 'hscroll-table' : variant}${edges.start ? '' : ' fade-start'}${edges.end ? '' : ' fade-end'}`}>
      <div className="hscroll-view">{createElement(as, { ref, className, ...rest }, children)}</div>
      {edges.start ? null : (
        <button type="button" className="lip iconbtn small hscroll-arrow prev" aria-label={label ? t.prevOf(label) : t.prev} onClick={() => slide(-1)}>
          <Icon name="back" />
        </button>
      )}
      {edges.end ? null : (
        <button type="button" className="lip iconbtn small hscroll-arrow next" aria-label={label ? t.nextOf(label) : t.next} onClick={() => slide(1)}>
          <Icon name="back" />
        </button>
      )}
    </div>
  );
}
