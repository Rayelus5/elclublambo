"use client";

import { useId, useState, useTransition } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { rpcErrorMessage } from "@/lib/errors";
import { postTicketMessageAction } from "@/lib/tickets/actions";
import { BODY_MAX, validateBody } from "@/lib/tickets/model";
import { cn } from "@/lib/utils";

/** Plain-text composer: Enter sends, Shift+Enter adds a new line, with a counter out of 4000. */
export function TicketComposer({ ticketId, onPosted }: { ticketId: string; onPosted: (messageId: string | null) => void }) {
  const uid = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = () => {
    if (pending) return;
    const body = validateBody(text);
    if (!body.ok) {
      if (text.length > BODY_MAX) setError(`El mensaje no puede pasar de ${BODY_MAX} caracteres.`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await postTicketMessageAction(ticketId, body.value).catch(() => ({ error: "unknown" }) as { id?: string; error?: string });
      if (res.error) {
        setError(rpcErrorMessage(res.error));
        return;
      }
      setText("");
      onPosted(res.id ?? null);
    });
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <Label htmlFor={`${uid}-text`}>Escribe tu respuesta</Label>
      <textarea
        id={`${uid}-text`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        rows={3}
        disabled={pending}
        aria-describedby={`${uid}-hint`}
        className="min-h-20 w-full resize-y rounded-control border border-border-strong bg-surface px-3 py-2 text-[15px] text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
      />
      <div className="flex items-center justify-between gap-3">
        <p id={`${uid}-hint`} className={cn("text-[13px]", text.length > BODY_MAX ? "text-danger" : "text-fg-muted")}>
          <span className="hidden sm:inline">Enter envía, Shift+Enter nueva línea. </span>
          <span className="font-mono">{text.length}/{BODY_MAX}</span>
        </p>
        <Button type="submit" disabled={pending || text.length > BODY_MAX}>
          <Send aria-hidden />
          {pending ? "Enviando…" : "Enviar"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="rounded-control border border-danger px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
