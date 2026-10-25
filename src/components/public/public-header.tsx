"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { LANGS, type Lang } from "@/lib/i18n/config";
import { localizedPath, switchLang, toPublicPath } from "@/lib/i18n/routes";
import type { PublicSession } from "@/lib/auth/public-session";
import { AccountChip } from "./account-chip";
import { PublicConnectLazy } from "./public-connect-lazy";

const focus =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded-control";

/** `session`: the signed-in wallet, null for a visitor, "pending" while the (dynamic) session is still being read. */
export function PublicHeader({ lang, session }: { lang: Lang; session: PublicSession | null | "pending" }) {
  const t = getDictionary(lang);
  // On the server usePathname() is the INTERNAL path (/es/tools); in the browser it is the public one (/herramientas).
  // Normalise to the public path so server and client render the same links.
  const raw = usePathname() ?? localizedPath(lang, "home");
  const pathname = toPublicPath(raw) ?? raw;

  return (
    <header className="border-b border-border bg-bg">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-8">
        <div className="flex items-center gap-4 sm:gap-6">
          <Link
            href={localizedPath(lang, "home")}
            aria-label={t.connect.home}
            className={`inline-flex min-h-11 items-center font-display text-lg leading-none font-black text-fg ${focus}`}
          >
            ElClub
            <span aria-hidden className="ml-[0.06em] inline-block size-[0.22em] bg-accent" />
          </Link>
          <nav aria-label={t.connect.mainNav}>
            <Link
              href={localizedPath(lang, "tools")}
              className={`inline-flex min-h-11 items-center px-2 text-sm font-bold text-fg-muted hover:text-fg ${focus}`}
            >
              {t.common.nav.tools}
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <nav aria-label={t.connect.language} className="flex items-center">
            {LANGS.map((l) => (
              <Link
                key={l}
                href={switchLang(pathname, l)}
                hrefLang={l}
                lang={l}
                aria-current={l === lang ? "true" : undefined}
                className={`inline-flex min-h-11 min-w-11 items-center justify-center font-mono text-[13px] uppercase ${
                  l === lang ? "font-bold text-accent" : "text-fg-muted hover:text-fg"
                } ${focus}`}
              >
                {l}
              </Link>
            ))}
          </nav>
          {session === "pending" ? (
            <div className="min-h-11 min-w-32" aria-hidden />
          ) : session ? (
            <AccountChip lang={lang} wallet={session.wallet} isMember={session.isMember} />
          ) : (
            <PublicConnectLazy lang={lang} next={pathname} variant="outline" />
          )}
        </div>
      </div>
    </header>
  );
}
