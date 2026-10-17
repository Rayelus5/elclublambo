"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Lock, RotateCcw } from "lucide-react";
import { LocalTime } from "@/components/tickets/local-time";
import { TicketBody } from "@/components/tickets/ticket-body";
import { TicketComposer } from "@/components/tickets/ticket-composer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { rpcErrorMessage } from "@/lib/errors";
import { createBrowserClient } from "@/lib/supabase/browser";
import { setTicketStatusAction } from "@/lib/tickets/actions";
import { getTicketMessage, getTicketMessages, getTicketState, type TicketMessageView, type TicketStatus } from "@/lib/tickets/queries";
import { mergeMessages } from "@/lib/tickets/model";
import { useTicketEvents } from "@/lib/tickets/realtime";
import { cn } from "@/lib/utils";

export interface TicketViewProps {
  ticket: { id: string; subject: string; status: TicketStatus; channelName: string; authorId: string };
  initialMessages: TicketMessageView[];
  /** `isStaff`: the reader holds MANAGE_TICKETS in the ticket's channel (the only ones who can reopen). */
  viewer: { isStaff: boolean };
  allowedDomains: readonly string[];
}

export function TicketView({ ticket, initialMessages, viewer, allowedDomains }: TicketViewProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [pending, startTransition] = useTransition();
  const seen = useRef(new Set(initialMessages.map((m) => m.id)));
  const endRef = useRef<HTMLDivElement>(null);
  // Focus target after a status change made from this screen: the control that triggered it disappears, so focus
  // would otherwise fall back to <body>. Realtime/remote changes never set it (they must not steal focus).
  const focusAfter = useRef<"closed" | "open" | null>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const reopenRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Events carry ids only: the message is always re-read through RLS, and never added twice.
  const addMessage = useCallback(
    async (id: string) => {
      if (seen.current.has(id)) return;
      seen.current.add(id);
      const m = await getTicketMessage(createBrowserClient(), id).catch(() => null);
      if (!m) {
        seen.current.delete(id);
        return;
      }
      setMessages((prev) => mergeMessages(prev, [m]));
    },
    [],
  );

  const refreshStatus = useCallback(async () => {
    const s = await getTicketState(createBrowserClient(), ticket.id).catch(() => null);
    if (s) setStatus(s.status);
  }, [ticket.id]);

  const resync = useCallback(async () => {
    // events may have been missed: re-read the status and every message in ONE query, adding the unseen ones sorted
    await refreshStatus();
    const all = await getTicketMessages(createBrowserClient(), ticket.id).catch(() => []);
    for (const m of all) seen.current.add(m.id);
    setMessages((prev) => mergeMessages(prev, all));
  }, [refreshStatus, ticket.id]);

  useTicketEvents(ticket.id, { onMessage: (id) => void addMessage(id), onUpdated: () => void refreshStatus(), onResync: () => void resync() });

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length]);

  useEffect(() => {
    const target = focusAfter.current;
    // wait for the transition to end: the buttons are disabled while it is pending and a disabled button can't focus
    if (!target || target !== status || pending) return;
    focusAfter.current = null;
    const el = status === "closed" ? (viewer.isStaff ? reopenRef.current : bannerRef.current) : closeRef.current;
    el?.focus();
  }, [status, pending, viewer.isStaff]);

  const change = (next: TicketStatus) => {
    setError(null);
    startTransition(async () => {
      const res = await setTicketStatusAction(ticket.id, next).catch(() => ({ error: "unknown" }) as { error?: string });
      if (res.error) {
        setError(rpcErrorMessage(res.error));
        return;
      }
      focusAfter.current = next;
      setStatus(next);
    });
  };

  const closed = status === "closed";
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          href="/tickets"
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-control text-sm font-bold text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Tickets
        </Link>
        <h1 className="text-h1 break-words">{ticket.subject}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex min-h-8 items-center rounded-control border px-2.5 text-[13px] font-bold",
              closed ? "border-border text-fg-muted" : "border-success text-success",
            )}
          >
            {closed ? "Cerrado" : "Abierto"}
          </span>
          <span className="text-[13px] text-fg-muted">en #{ticket.channelName}</span>
          <span className="flex-1" />
          {!closed ? (
            <Button ref={closeRef} type="button" variant="secondary" disabled={pending} onClick={() => setConfirmClose(true)}>
              <Lock aria-hidden />
              Cerrar ticket
            </Button>
          ) : viewer.isStaff ? (
            <Button ref={reopenRef} type="button" variant="secondary" disabled={pending} onClick={() => change("open")}>
              <RotateCcw aria-hidden />
              Reabrir ticket
            </Button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="rounded-control border border-danger px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </header>

      <ol aria-label="Mensajes del ticket" className="flex flex-col gap-3">
        {messages.map((m) => (
          <li
            key={m.id}
            className={cn(
              "flex flex-col gap-1.5 rounded-panel border px-4 py-3",
              m.isStaff ? "border-border-strong bg-surface-2" : "border-border bg-surface",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-sm font-bold text-fg">{m.authorName}</span>
              {m.isStaff ? (
                <span className="inline-flex items-center rounded-control border border-accent px-1.5 text-[11px] font-bold text-accent">
                  Staff
                </span>
              ) : null}
              <LocalTime iso={m.createdAt} className="text-[13px] text-fg-muted" />
            </div>
            <TicketBody text={m.bodyText} allowLinks={m.allowLinks} allowedDomains={allowedDomains} />
          </li>
        ))}
      </ol>
      <div ref={endRef} aria-hidden />

      {closed ? (
        <div
          ref={bannerRef}
          role="status"
          tabIndex={-1}
          className="flex items-start gap-3 rounded-panel border border-border-strong bg-surface px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Lock className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <strong className="text-sm font-bold text-fg">Ticket cerrado</strong>
            <span className="text-[13px] text-fg-muted">
              Ya no se puede escribir aquí. {viewer.isStaff ? "Puedes reabrirlo." : "Solo el equipo puede reabrirlo; si necesitas algo más, abre otro ticket."}
            </span>
          </div>
        </div>
      ) : null}
      <TicketComposer
        ticketId={ticket.id}
        closed={closed}
        onPosted={(id) => (id ? void addMessage(id) : undefined)}
        onError={(code) => {
          if (code === "ticket_closed") void refreshStatus();
        }}
      />

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cerrar este ticket?</AlertDialogTitle>
            <AlertDialogDescription>
              Nadie podrá escribir más en él. Solo el equipo puede reabrirlo; si necesitas algo más después, tendrás que abrir otro ticket.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => change("closed")}>Sí, cerrar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
