"use client";

import { useSyncExternalStore } from "react";
import { formatClose, formatCountdown } from "@/lib/giveaways/format";

// One shared ticking clock (whole seconds). The server snapshot is null, so the first paint shows the absolute date and
// the countdown takes over after hydration without a mismatch.
const subscribe = (onTick: () => void) => {
  const t = setInterval(onTick, 1000);
  return () => clearInterval(t);
};
const nowSeconds = () => Math.floor(Date.now() / 1000);
const serverNow = () => null;

export function useNowSeconds(): number | null {
  return useSyncExternalStore(subscribe, nowSeconds, serverNow);
}

/** Public pages' copy: templates with {t} (time left) and {d} (date), plus the date locale. */
export type CountdownLabels = { closesIn: string; closesOn: string; locale: string };

/** «Cierra en 2 h 5 min» until the close; then `endedText`. Not a live region: a ticking announcement is noise. */
export function Countdown({
  closesAt,
  endedText = "Esperando el sorteo",
  className,
  labels,
}: {
  closesAt: string;
  endedText?: string;
  className?: string;
  /** Without it, the club's Spanish texts. */
  labels?: CountdownLabels;
}) {
  const now = useNowSeconds();
  const at = Date.parse(closesAt);
  const left = now === null ? null : formatCountdown(at - now * 1000);
  const date = labels
    ? new Intl.DateTimeFormat(labels.locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(closesAt))
    : formatClose(closesAt);
  const closesOn = labels ? labels.closesOn.replace("{d}", date) : `Cierra el ${date}`;
  const closesIn = (l: string) => (labels ? labels.closesIn.replace("{t}", l) : `Cierra en ${l}`);
  const text = now === null ? closesOn : left ? closesIn(left) : endedText;
  return (
    <time dateTime={closesAt} title={date} suppressHydrationWarning className={className}>
      {text}
    </time>
  );
}

/** True from `closesAt` on (re-evaluated every second); false during the server render. */
export function usePastClose(closesAt: string): boolean {
  const now = useNowSeconds();
  return now !== null && now * 1000 >= Date.parse(closesAt);
}
