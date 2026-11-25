"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { notFoundVariant } from "@/lib/status/not-found-variant";

/**
 * Picks the 404 variant on a client navigation, where the inline boot script is an inert data block: before the paint
 * (layout effect), from the URL the browser shows (a 404 the proxy rewrote has another path inside the app). Runs again
 * when the path changes, in case React keeps this 404 mounted from one section to another, and clears the variant when
 * the 404 goes, so html carries no stale one.
 */
export function NotFoundVariantSync() {
  const pathname = usePathname();
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.nf = notFoundVariant(window.location.pathname);
    return () => {
      delete root.dataset.nf;
    };
  }, [pathname]);
  return null;
}
