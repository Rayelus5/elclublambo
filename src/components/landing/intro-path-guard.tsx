"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { isIntroPath, takeEarlyTap } from "@/lib/landing/intro";

/**
 * The intro only lives on the homes. A visitor can leave one without passing the gate (a screen reader in browse mode
 * reaches the header and footer links under the overlay); the client navigation unmounts <IntroGate> but nothing else
 * would clear html[data-intro], which locks the scroll and pauses the /start hero site-wide. This guard, mounted once
 * in the root layout, clears it on every path outside INTRO_PATHS.
 *
 * Not in IntroGate's unmount cleanup: the StrictMode dev remount would clear the attribute and kill the intro. Here the
 * effect is idempotent and only reads the path. It reads window.location (written by Next before effects run), not the
 * hook's value, which on the server is the internal path (/es) — the hook only re-runs it on navigation.
 */
export function IntroPathGuard() {
  const pathname = usePathname();
  useEffect(() => {
    const root = document.documentElement;
    if (!root.hasAttribute("data-intro") || isIntroPath(window.location.pathname)) return;
    delete root.dataset.intro;
    takeEarlyTap();
  }, [pathname]);
  return null;
}
