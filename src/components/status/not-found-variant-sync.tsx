"use client";

import { useLayoutEffect } from "react";
import { notFoundVariant } from "@/lib/status/not-found-variant";

/**
 * Picks the 404 variant on a client navigation, where the inline boot script is an inert data block: before the paint
 * (layout effect), from the URL the browser shows. Clears it when the 404 goes, so html carries no stale variant.
 */
export function NotFoundVariantSync() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.nf = notFoundVariant(window.location.pathname);
    return () => {
      delete root.dataset.nf;
    };
  }, []);
  return null;
}
