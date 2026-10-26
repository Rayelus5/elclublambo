"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSyncExternalStore, type MouseEvent } from "react";
import { getDictionary } from "@/lib/i18n";
import { LANGS, type Lang } from "@/lib/i18n/config";
import { localizedPath, switchLang, toPublicPath } from "@/lib/i18n/routes";

/**
 * The URL's query, without useSearchParams (it would need its own Suspense in every shell). A path change re-renders
 * the header and React re-reads the snapshot after the commit, once Next has written the URL; back / forward
 * (popstate) and a query-only change on the same path (Navigation API `currententrychange`, where the browser has it)
 * notify here.
 */
export function subscribeLocation(onChange: () => void) {
  const navigation = (window as { navigation?: EventTarget }).navigation;
  // Next writes the URL inside an insertion effect and Chrome fires currententrychange right there; React forbids
  // scheduling an update from it, so the notification waits for the end of that commit.
  let live = true;
  const notify = () => queueMicrotask(() => live && onChange());
  window.addEventListener("popstate", notify);
  navigation?.addEventListener("currententrychange", notify);
  return () => {
    live = false;
    window.removeEventListener("popstate", notify);
    navigation?.removeEventListener("currententrychange", notify);
  };
}

const focus =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded-control";

/**
 * ES / EN links to the same page; they keep the query (/herramientas/avales?address=… → /en/tools/vouches?address=…).
 * In the header it is the «Idioma» navigation landmark. Given `labelledBy` (the footer, under its own «Idioma» heading)
 * it is a plain group named by that heading, so the page does not carry two landmarks with the same name.
 */
export function LangSwitch({ lang, className = "", labelledBy }: { lang: Lang; className?: string; labelledBy?: string }) {
  const t = getDictionary(lang);
  // On the server usePathname() is the INTERNAL path (/es/tools); in the browser it is the public one (/herramientas).
  // Normalise to the public path so server and client render the same links.
  const raw = usePathname() ?? localizedPath(lang, "home");
  const pathname = toPublicPath(raw) ?? raw;
  const router = useRouter();
  // The server and the hydration pass render the path alone, the browser then adds the query (subscribeLocation); a
  // click re-reads it in case it changed unheard (a browser without the Navigation API).
  const search = useSyncExternalStore(subscribeLocation, () => window.location.search, () => "");
  const keepQuery = (base: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    const now = window.location.search;
    if (now === search || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    router.push(`${base}${now}`);
  };

  const links = LANGS.map((l) => (
    <Link
      key={l}
      href={`${switchLang(pathname, l)}${search}`}
      onClick={keepQuery(switchLang(pathname, l))}
      hrefLang={l}
      lang={l}
      aria-current={l === lang ? "true" : undefined}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center font-mono text-[13px] uppercase ${
        l === lang ? "font-bold text-accent" : "text-fg-muted hover:text-fg"
      } ${focus}`}
    >
      {l}
    </Link>
  ));
  const cls = `flex items-center ${className}`;
  return labelledBy ? (
    <div role="group" aria-labelledby={labelledBy} className={cls}>
      {links}
    </div>
  ) : (
    <nav aria-label={t.connect.language} className={cls}>
      {links}
    </nav>
  );
}
