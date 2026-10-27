"use client";

import { useSyncExternalStore } from "react";
import { DATE_LOCALE } from "@/lib/i18n/fill";
import type { Lang } from "@/lib/i18n/config";

const OPTIONS = { dateStyle: "medium", timeStyle: "short" } as const;
const noop = () => () => {};

/** A moment in the reader's time zone. The server (and the first paint) shows it in UTC, marked as such. */
export function LocalTime({ iso, lang }: { iso: string; lang: Lang }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const text = mounted
    ? new Intl.DateTimeFormat(DATE_LOCALE[lang], OPTIONS).format(date)
    : `${new Intl.DateTimeFormat(DATE_LOCALE[lang], { ...OPTIONS, timeZone: "UTC" }).format(date)} UTC`;
  return (
    <time dateTime={iso} className="tabular-nums text-fg">
      {text}
    </time>
  );
}
