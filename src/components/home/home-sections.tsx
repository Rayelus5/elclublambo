import type { ReactNode } from "react";
import Link from "next/link";
import { Hash, Pin } from "lucide-react";
import { messageHref, type ActiveChannel, type HomePin } from "@/lib/home/queries";

const ROW =
  "flex min-h-11 items-start gap-3 rounded-control px-2 py-2 outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent";

const FAILED = <p className="text-sm text-fg-muted">No se pudo cargar. Recarga la página.</p>;

/**
 * An unboxed Inicio section: a heading, an optional action and its content. `failed` replaces the content with a short
 * error, so one broken read never blanks the page.
 */
export function HomeSection({
  id,
  title,
  action,
  failed = false,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  failed?: boolean;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h2 id={id} className="text-h3">
          {title}
        </h2>
        {action}
      </div>
      {failed ? FAILED : children}
    </section>
  );
}

export function PinnedList({ pins }: { pins: readonly HomePin[] }) {
  if (pins.length === 0) return <p className="text-sm text-fg-muted">No hay anuncios fijados.</p>;
  return (
    <ul aria-label="Anuncios fijados" className="flex flex-col">
      {pins.map((p) => (
        <li key={p.messageId}>
          <Link href={messageHref(p.channelId, p.messageId)} className={ROW}>
            <Pin aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="line-clamp-2 text-sm text-fg">{p.excerpt || "Mensaje fijado"}</span>
              <span className="text-[13px] text-fg-muted">
                #{p.channelName}
                {p.authorLabel ? ` · ${p.authorLabel}` : ""}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ActiveChannelsList({ channels }: { channels: readonly ActiveChannel[] }) {
  if (channels.length === 0) return <p className="text-sm text-fg-muted">Esta semana todavía no hay conversación.</p>;
  return (
    <ul aria-label="Canales con actividad" className="flex flex-wrap gap-2">
      {channels.map((c) => (
        <li key={c.channelId}>
          <Link
            href={`/c/${c.channelId}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border px-3 text-sm text-fg outline-none hover:border-border-strong hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Hash aria-hidden className="size-4 text-fg-muted" />
            {c.channelName}
            <span className="font-mono text-[13px] text-fg-muted">{c.recentCount}</span>
            <span className="sr-only">{c.recentCount === 1 ? "mensaje esta semana" : "mensajes esta semana"}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
