/** Centres a message in its scroller. Instant under `prefers-reduced-motion`, smooth otherwise. */
export function scrollMessageIntoView(el: Element): void {
  const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView?.({ block: "center", behavior: reduce ? "auto" : "smooth" });
}
