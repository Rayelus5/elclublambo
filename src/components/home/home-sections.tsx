import type { ReactNode } from "react";
import Link from "next/link";
import { AtSign, BellRing, Hash, MessageSquareReply, Pin, Target } from "lucide-react";
import { ShareRing } from "@/components/treasury/dao-charts";
import { DonateButton } from "@/components/treasury/donate-button";
import { messageHref, type ActiveChannel, type HomeBounty, type HomePin, type UnreadSummary } from "@/lib/home/queries";
import { formatAmount } from "@/lib/payments/amounts";
import { formatBps, formatUsd } from "@/lib/treasury/format";
import type { DaoOverview } from "@/lib/treasury/queries";

const LINK =
  "inline-flex min-h-11 items-center rounded-control text-sm font-bold text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent";
const ROW =
  "flex min-h-11 items-start gap-3 rounded-control px-2 py-2 outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent";

/** A titled panel; `failed` replaces the body with a short error so one broken section never blanks the page. */
export function HomeCard({
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
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="text-h3">
          {title}
        </h2>
        {action}
      </div>
      {failed ? <p className="text-sm text-fg-muted">No se pudo cargar. Recarga la página.</p> : children}
    </section>
  );
}

export function UnreadBanner({ unread }: { unread: UnreadSummary }) {
  if (unread.total === 0) {
    return (
      <p className="flex items-center gap-2 rounded-panel border border-border bg-surface px-4 py-3 text-sm text-fg-muted">
        <BellRing aria-hidden className="size-4" />
        Estás al día: no tienes notificaciones sin leer.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-accent bg-surface px-4 py-3">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg">
        <span className="font-bold">{unread.total === 1 ? "1 sin leer" : `${unread.total} sin leer`}</span>
        <span className="inline-flex items-center gap-1.5 text-fg-muted">
          <AtSign aria-hidden className="size-4" />
          {unread.mentions === 1 ? "1 mención" : `${unread.mentions} menciones`}
        </span>
        <span className="inline-flex items-center gap-1.5 text-fg-muted">
          <MessageSquareReply aria-hidden className="size-4" />
          {unread.replies === 1 ? "1 respuesta" : `${unread.replies} respuestas`}
        </span>
      </p>
      <Link href="/notifications" className={LINK}>
        Ver notificaciones
      </Link>
    </div>
  );
}

export function OpenBountiesList({ bounties }: { bounties: readonly HomeBounty[] }) {
  if (bounties.length === 0) return <p className="text-sm text-fg-muted">No hay bounties abiertos ahora mismo.</p>;
  return (
    <ul aria-label="Bounties abiertos" className="flex flex-col">
      {bounties.map((b) => (
        <li key={b.messageId}>
          <Link href={messageHref(b.channelId, b.messageId)} className={ROW}>
            <Target aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm text-fg">{b.excerpt || "Bounty"}</span>
              <span className="text-[13px] text-fg-muted">
                #{b.channelName}
                {b.status === "solution_marked" ? " · solución elegida" : ""}
              </span>
            </span>
            <span className="shrink-0 font-mono text-sm font-bold text-fg">
              {formatAmount(b.amount, b.token)} {b.token}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function DaoSummary({ overview }: { overview: DaoOverview }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <ShareRing bps={overview.myShareBps} />
        <dl className="grid flex-1 grid-cols-2 gap-3">
          <div>
            <dt className="text-[13px] text-fg-muted">Valor del fondo</dt>
            <dd className="font-display text-xl font-black break-all text-fg">{formatUsd(overview.navUsd6)}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-fg-muted">Tu parte</dt>
            <dd className="font-mono text-lg font-bold text-fg">{formatBps(overview.myShareBps)}</dd>
          </div>
        </dl>
      </div>
      <p className="text-[13px] text-fg-muted">{overview.donors === 1 ? "1 donante" : `${overview.donors} donantes`} en esta red.</p>
      <div className="flex flex-wrap items-center gap-3">
        <DonateButton />
        <Link href="/dao" className={LINK}>
          Ver la DAO
        </Link>
      </div>
    </div>
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
