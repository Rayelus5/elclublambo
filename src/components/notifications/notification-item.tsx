import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { NotificationView } from "@/lib/notifications/queries";

/** The sentence of a notice. The actor always comes from `members` (see queries.ts), never from message content. */
export function notificationCopy(n: NotificationView): ReactNode {
  const actor = <strong className="font-bold text-fg">{n.actor?.name ?? "Alguien"}</strong>;
  const channel = `#${n.channelName ?? "canal"}`;
  const subject = n.ticketSubject ?? "sin asunto";
  switch (n.kind) {
    case "mention":
      return <>{actor} te mencionó en {channel}</>;
    case "reply":
      return <>{actor} respondió en un hilo de {channel}</>;
    case "channel_message":
      return <>{actor} escribió en {channel}</>;
    case "invite_redeemed":
      return <>{actor} canjeó tu invitación</>;
    case "godchild_banned":
      return <>Han baneado a tu ahijado {actor}</>;
    case "sponsor_penalized":
      return <>Has perdido el permiso de invitar porque baneamos a {actor}</>;
    case "report_new":
      return <>Nuevo reporte en {channel}</>;
    case "member_review":
      return <>{actor} está marcado para revisar</>;
    case "ticket_new":
      return <>Nuevo ticket: <strong className="font-bold text-fg">{subject}</strong></>;
    case "ticket_reply":
      return <>Respuesta en el ticket <strong className="font-bold text-fg">{subject}</strong></>;
    case "tip_received":
      return n.actor ? <>{actor} te ha enviado una propina</> : <>Has recibido una propina anónima</>;
    case "ticket_status":
      return (
        <>
          Ticket <strong className="font-bold text-fg">{subject}</strong> {n.ticketStatus === "closed" ? "cerrado" : "reabierto"}
        </>
      );
  }
}

const time = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function NotificationItem({
  notification: n,
  onOpen,
}: {
  notification: NotificationView;
  /** Called when the link is followed (the list marks the notice as read). */
  onOpen?: (n: NotificationView) => void;
}) {
  const unread = n.readAt === null;
  return (
    <li>
      <Link
        href={n.href}
        onClick={() => onOpen?.(n)}
        className={cn(
          "flex min-h-11 items-start gap-3 rounded-control border border-transparent px-3 py-3 outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:transition-none",
          unread ? "bg-surface" : "text-fg-muted",
        )}
      >
        <span className="mt-1.5 flex size-2.5 shrink-0 items-center justify-center">
          {unread ? <span role="img" aria-label="sin leer" className="size-2.5 rounded-full bg-accent" /> : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm break-words">{notificationCopy(n)}</span>
          {n.excerpt ? <span className="text-sm break-words text-fg-muted">{n.excerpt}</span> : null}
          <time dateTime={n.createdAt} suppressHydrationWarning className="font-mono text-[12px] text-fg-muted">
            {time.format(new Date(n.createdAt))}
          </time>
        </span>
      </Link>
    </li>
  );
}
