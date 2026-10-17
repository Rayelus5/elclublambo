"use client";

import { useId, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { rpcErrorMessage } from "@/lib/errors";
import { postTicketMessageAction } from "@/lib/tickets/actions";
import { BODY_MAX, cpLength, validateBody } from "@/lib/tickets/model";
import { cn } from "@/lib/utils";

const AREA =
  "min-h-20 w-full resize-y rounded-control border border-border-strong bg-surface px-3 py-2 text-[15px] text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

/**
 * Plain-text composer: Enter sends, Shift+Enter adds a new line, with a counter out of 4000 (code points, like the
 * database). The textarea is never disabled while sending (it would drop the focus): a ref guards double submits.
 * When the ticket closes the draft stays on screen, read-only, so it can still be copied.
 */
export function TicketComposer({
  ticketId,
  closed,
  onPosted,
  onError,
}: {
  ticketId: string;
  closed: boolean;
  onPosted: (messageId: string | null) => void;
  /** Called with the error code of a failed post (the view refreshes the status on `ticket_closed`). */
  onError?: (code: string) => void;
}) {
  const uid = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const busy = useRef(false);

  const send = async () => {
    if (busy.current) return;
    const body = validateBody(text);
    if (!body.ok) {
      if (cpLength(text) > BODY_MAX) setError(`El mensaje no puede pasar de ${BODY_MAX} caracteres.`);
      return;
    }
    busy.current = true;
    setSending(true);
    setError(null);
    const res = await postTicketMessageAction(ticketId, body.value).catch(() => ({ error: "unknown" }) as { id?: string; error?: string });
    busy.current = false;
    setSending(false);
    if (res.error) {
      setError(rpcErrorMessage(res.error));
      onError?.(res.error);
      return;
    }
    setText("");
    onPosted(res.id ?? null);
  };

  const errorBox = error ? (
    <p role="alert" className="rounded-control border border-danger px-3 py-2 text-[13px] text-danger">
      {error}
    </p>
  ) : null;

  if (closed) {
    if (text === "") return errorBox;
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${uid}-draft`}>Tu borrador sin enviar</Label>
        <textarea id={`${uid}-draft`} value={text} readOnly rows={3} className={cn(AREA, "text-fg-muted")} />
        {errorBox}
      </div>
    );
  }

  const count = cpLength(text);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <Label htmlFor={`${uid}-text`}>Escribe tu respuesta</Label>
      <textarea
        id={`${uid}-text`}
        value={text}
        readOnly={sending}
        aria-busy={sending}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
        rows={3}
        aria-describedby={`${uid}-hint`}
        className={cn(AREA, sending && "opacity-60")}
      />
      <div className="flex items-center justify-between gap-3">
        <p id={`${uid}-hint`} className={cn("text-[13px]", count > BODY_MAX ? "text-danger" : "text-fg-muted")}>
          <span className="hidden sm:inline">Enter envía, Shift+Enter nueva línea. </span>
          <span className="font-mono">{count}/{BODY_MAX}</span>
        </p>
        <Button type="submit" disabled={sending || count > BODY_MAX}>
          <Send aria-hidden />
          {sending ? "Enviando…" : "Enviar"}
        </Button>
      </div>
      {errorBox}
    </form>
  );
}
