"use client";

import type { MouseEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";

// Anything that already does something on click keeps its own behaviour.
const INTERACTIVE = "a[href], button, input, select, textarea, label, summary, [role=button], [role=link]";

/**
 * T-003: a market row that opens its coin when tapped anywhere. The real link in the name cell stays the only tab
 * stop and the screen-reader affordance; this handler only widens the pointer target. No stretched ::after overlay:
 * where a <tr> is not a containing block, an overlay would escape to the panel and swallow every click in it.
 */
export function MarketRow({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();

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
      className="cursor-pointer border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-surface-2 active:bg-surface-2 has-[a:focus-visible]:bg-surface-2 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-accent motion-reduce:transition-none"
    >
      {children}
    </tr>
  );
}
