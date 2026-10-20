"use client";

import { useRef, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

// Anything that already does something on click keeps its own behaviour.
const INTERACTIVE = "a[href], button, input, select, textarea, label, summary, [role=button], [role=link]";

/**
 * T-003: a market row that opens its coin when tapped anywhere. The real link in the name cell stays the only tab
 * stop and the screen-reader affordance; this handler only widens the pointer target. No stretched ::after overlay:
 * where a <tr> is not a containing block, an overlay would escape to the panel and swallow every click in it.
 * T-006: the coin is prefetched on intent (pointer over the row, a touch, focus on its link), once; the link itself has
 * `prefetch={false}`, so up to 100 revealed rows do not each fetch their page as they scroll into view.
 */
export function MarketRow({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  const prefetched = useRef(false);
  function prefetch() {
    if (prefetched.current) return;
    prefetched.current = true;
    router.prefetch(href);
  }

  function onClick(e: MouseEvent<HTMLTableRowElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return;
    // The click that ends a text selection (copying a price) is not a navigation.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString() !== "") return;
    router.push(href);
  }

  return (
    <tr
      onClick={onClick}
      onPointerEnter={prefetch}
      onTouchStart={prefetch}
      onFocus={prefetch}
      className="cursor-pointer border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-surface-2 active:bg-surface-2 has-[a:focus-visible]:bg-surface-2 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-accent motion-reduce:transition-none"
    >
      {children}
    </tr>
  );
}
