"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { rpcErrorMessage } from "@/lib/errors";
import { reportMessageAction } from "@/lib/reports/actions";
import { REPORT_NOTE_MAX, REPORT_REASON_LABEL, REPORT_REASONS, type ReportReason } from "@/lib/reports/reasons";
import { cn } from "@/lib/utils";

const HINT: Record<ReportReason, string> = {
  scam: "Intenta engañar o quitar dinero o claves.",
  spam: "Publicidad o mensajes repetidos que no aportan.",
  abuse: "Insultos, acoso o contenido que ataca a alguien.",
  other: "Algo más que el equipo debería revisar.",
};

/**
 * Report a message. Controlled by the caller (the message menu opens it). The reporter only learns that the report
 * was sent: who sees it, and what happens next, stays with the moderators.
 */
export function ReportDialog({
  messageId,
  open,
  onOpenChange,
}: {
  messageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const uid = useId();
  const noteId = `${uid}-note`;
  const errorId = `${uid}-error`;
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setReason(null);
    setNote("");
    setError(null);
    setDone(false);
  };

  const change = (next: boolean) => {
    if (pending) return;
    onOpenChange(next);
    if (!next) reset();
  };

  const submit = () => {
    if (!reason) {
      setError("Elige un motivo.");
      return;
    }
    const trimmed = note.trim();
    if (trimmed.length > REPORT_NOTE_MAX) {
      setError(`La nota no puede pasar de ${REPORT_NOTE_MAX} caracteres.`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await reportMessageAction(messageId, reason, trimmed === "" ? null : trimmed).catch(
        () => ({ error: "unknown" }) as { error?: string },
      );
      // Nested transition: updates after an await are not part of the outer one, so without it the result would
      // commit while `pending` is still true (error shown next to an "Enviando…" button).
      startTransition(() => {
        if (res.error) setError(rpcErrorMessage(res.error));
        else setDone(true);
      });
    });
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-md">
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-lg font-bold">Reporte enviado</DialogTitle>
              <DialogDescription>Gracias por avisar. El equipo de moderación lo revisará.</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end">
              <DialogClose asChild>
                <Button type="button">Listo</Button>
              </DialogClose>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-lg font-bold">Reportar mensaje</DialogTitle>
              <DialogDescription>
                Cuéntanos qué pasa. Solo lo verá el equipo de moderación, nunca el autor del mensaje.
              </DialogDescription>
            </DialogHeader>

            <fieldset className="flex flex-col gap-1" disabled={pending}>
              <legend className="mb-1 text-sm font-medium text-fg">Motivo</legend>
              {REPORT_REASONS.map((r) => (
                <label
                  key={r}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-start gap-3 rounded-control border px-3 py-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                    reason === r ? "border-accent bg-surface-2" : "border-border hover:bg-surface-2",
                  )}
                >
                  <input
                    type="radio"
                    name={`${uid}-reason`}
                    value={r}
                    checked={reason === r}
                    onChange={() => {
                      setReason(r);
                      setError(null);
                    }}
                    aria-describedby={error ? errorId : undefined}
                    className="mt-0.5 size-4 shrink-0 accent-accent outline-none"
                  />
                  <span className="flex flex-col">
                    <span className="text-sm font-bold text-fg">{REPORT_REASON_LABEL[r]}</span>
                    <span className="text-[13px] text-fg-muted">{HINT[r]}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="flex flex-col gap-2">
              <Label htmlFor={noteId}>Nota (opcional)</Label>
              <textarea
                id={noteId}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                disabled={pending}
                aria-describedby={`${noteId}-count`}
                className="min-h-20 w-full resize-y rounded-control border border-border-strong bg-surface px-3 py-2 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
              />
              <p
                id={`${noteId}-count`}
                className={cn("text-right text-[13px]", note.trim().length > REPORT_NOTE_MAX ? "text-danger" : "text-fg-muted")}
              >
                {note.trim().length}/{REPORT_NOTE_MAX}
              </p>
            </div>

            {error ? (
              <p id={errorId} role="alert" className="rounded-control border border-danger px-3 py-2 text-[13px] text-danger">
                {error}
              </p>
            ) : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" disabled={pending} onClick={() => change(false)}>
                Cancelar
              </Button>
              <Button type="button" disabled={pending} onClick={submit}>
                {pending ? "Enviando…" : "Enviar reporte"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
