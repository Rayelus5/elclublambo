import Link from "next/link";
import { ArrowLeft, Users } from "lucide-react";
import { Countdown } from "@/components/giveaways/countdown";
import { shortAddress } from "@/lib/auth/wallet";
import type { Dictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { DATE_LOCALE, fill } from "@/lib/i18n/fill";
import { localizedPath } from "@/lib/i18n/routes";
import type { PublicGiveawayView } from "@/lib/public-giveaways/types";
import { cn } from "@/lib/utils";
import { ShareButton } from "./share-button";

type Detail = Dictionary["giveaways"]["detail"];

/** Title, organizer, status, countdown (or close date) and entry count, with «Compartir». */
export function GiveawayHeader({ lang, view: g, t, free }: { lang: Lang; view: PublicGiveawayView; t: Detail; free: string }) {
  const open = g.status === "open";
  const closed = new Intl.DateTimeFormat(DATE_LOCALE[lang], { dateStyle: "medium", timeStyle: "short" }).format(new Date(g.closesAt));
  const entries = fill(g.entryCount === 1 ? t.entryOne : t.entryMany, { n: g.entryCount });
  return (
    <header className="flex flex-col gap-4">
      <Link
        href={localizedPath(lang, "giveaways")}
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-control text-sm font-bold text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t.back}
      </Link>
      <div className="flex flex-col gap-2">
        <span
          className={cn(
            "self-start rounded-control border px-2 py-0.5 text-[13px] font-bold",
            open || g.status === "drawn" ? "border-accent text-accent" : "border-border-strong text-fg-muted",
          )}
        >
          {t.status[g.status]}
        </span>
        <h1 className="min-w-0 font-display text-2xl font-bold break-words text-fg sm:text-h1">{g.title}</h1>
        <p className="text-sm text-fg-muted">
          {`${t.hostedBy} `}
          <span className={cn("font-bold text-fg", g.hostName ? undefined : "font-mono")}>{g.hostName ?? shortAddress(g.hostAddress)}</span>
        </p>
      </div>
      {g.description ? <p className="max-w-2xl break-words whitespace-pre-line text-fg-muted">{g.description}</p> : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
        {open ? (
          <Countdown
            closesAt={g.closesAt}
            endedText={t.status.closed}
            labels={{ closesIn: t.closesIn, closesOn: t.closesOn, locale: DATE_LOCALE[lang] }}
            className="font-mono font-bold text-fg tabular-nums"
          />
        ) : (
          <span suppressHydrationWarning>{fill(t.closedOn, { d: closed })}</span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <Users aria-hidden className="size-4" />
          {entries}
        </span>
      </div>
      {g.status === "cancelled" ? <p className="text-sm">{t.cancelledNote}</p> : null}
      {g.status === "void" ? <p className="text-sm">{t.voidNote}</p> : null}
      <p className="text-[13px] text-fg-muted">{free}</p>
      <ShareButton path={localizedPath(lang, "giveaway", { id: g.id })} title={g.title} t={t.share} />
    </header>
  );
}
