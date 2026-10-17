import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import type { TicketListItem } from "@/lib/tickets/queries";

const date = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** List of tickets (server component). `showAuthor` is for the support inbox, where the author is somebody else. */
export function TicketList({ items, showAuthor, empty }: { items: TicketListItem[]; showAuthor: boolean; empty: string }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-panel border border-border bg-surface p-6">
        <LifeBuoy className="size-5 text-fg-muted" aria-hidden />
        <p className="text-fg-muted">{empty}</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {items.map((t) => (
        <li key={t.id}>
          <Link
            href={`/tickets/${t.id}`}
            className="flex min-h-11 flex-col gap-1 rounded-panel border border-border bg-surface p-4 transition-colors duration-150 outline-none hover:border-border-strong hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:transition-none"
          >
            <span className="font-display text-base font-bold break-words text-fg">{t.subject}</span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-muted">
              <span>#{t.channelName}</span>
              {showAuthor ? <span>{t.authorName}</span> : null}
              <time dateTime={t.lastMessageAt}>{date.format(new Date(t.lastMessageAt))}</time>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
