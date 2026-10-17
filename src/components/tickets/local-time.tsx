"use client";

const FORMAT = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** A date in the viewer's own time zone. The server renders it in its zone: the client text wins on hydration. */
export function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {FORMAT.format(d)}
    </time>
  );
}
