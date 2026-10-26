"use client";

import { Suspense, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { MAINTENANCE_BANNER_COOKIE } from "@/lib/admin/access";
import { getDictionary } from "@/lib/i18n";

const noop = () => () => {};
const readCookie = () => document.cookie.split(/;\s*/).includes(`${MAINTENANCE_BANNER_COOKIE}=1`);

/**
 * A-R15: «Mantenimiento activo», for whoever the proxy lets through during maintenance. Cosmetic only. The cookie is read
 * on every render, so a route change (usePathname) re-reads it. While shown, its height goes to `--mnt-banner-h`, which
 * pads the body and pushes the club's sticky header and rails down (globals.css), so it never covers content.
 */
/** Mounted once in Providers. Its own <Suspense>: usePathname() is request data on dynamic routes. */
export function MaintenanceBanner() {
  return (
    <Suspense fallback={null}>
      <Banner />
    </Suspense>
  );
}

function Banner() {
  const pathname = usePathname() ?? "/";
  const on = useSyncExternalStore(noop, readCookie, () => false);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const root = document.documentElement;
    const sync = () => root.style.setProperty("--mnt-banner-h", `${el.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--mnt-banner-h");
    };
  }, [on]);

  if (!on) return null;
  const lang = pathname === "/en" || pathname.startsWith("/en/") ? "en" : "es";
  return (
    <div
      ref={ref}
      role="status"
      lang={lang}
      className="fixed inset-x-0 top-0 z-45 flex min-h-9 items-center justify-center gap-2 border-b border-accent bg-surface-2 px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-center text-[13px] font-bold text-fg"
    >
      <span aria-hidden className="size-2 shrink-0 bg-accent" />
      {getDictionary(lang).status.banner}
    </div>
  );
}
