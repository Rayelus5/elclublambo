"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Dices, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cancelGiveawayAction, drawGiveawayNowAction, markPrizeDeliveredAction } from "@/lib/giveaways/actions";

const REASON_MAX = 280;
const FIELD =
  "min-h-11 w-full rounded-control border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg md:text-sm";

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, onOk?: () => void) => {
    setError(null);
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) return setError(r.error);
        onOk?.();
        router.refresh();
      } catch {
        setError("No se pudo completar la acción. Inténtalo de nuevo.");
      }
    });
  };
  return { error, pending, run };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-danger">
      {error}
    </p>
  ) : null;
}

/** «Sortear ahora»: once the drand round exists (round_not_ready before). */
export function DrawNowButton({ id }: { id: string }) {
  const { error, pending, run } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" className="self-start" disabled={pending} onClick={() => run(() => drawGiveawayNowAction(id))}>
        {pending ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Dices aria-hidden />}
        Sortear ahora
      </Button>
      <ErrorLine error={error} />
    </div>
  );
}

/** «Marcar entregado» of a prize handed over by hand. */
export function MarkDeliveredButton({ prizeId }: { prizeId: string }) {
  const { error, pending, run } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <Button type="button" size="sm" disabled={pending} onClick={() => run(() => markPrizeDeliveredAction(prizeId))}>
        {pending ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
        Marcar entregado
      </Button>
      <ErrorLine error={error} />
    </div>
  );
}

/** «Cancelar» with a public reason. The seed is deleted, never revealed. */
export function CancelGiveawayButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const { error, pending, run } = useAction();
  const trimmed = reason.trim();
  const invalid = trimmed.length < 1 || trimmed.length > REASON_MAX;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    run(() => cancelGiveawayAction(id, trimmed), () => setOpen(false));
  }

  return (
    <>
      <Button type="button" variant="outline" className="self-start" onClick={() => setOpen(true)}>
        Cancelar
      </Button>
      <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold">Cancelar sorteo</DialogTitle>
            <DialogDescription>El motivo se publica en el sorteo. No se puede deshacer.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor={`cancel-${id}`} className="text-sm font-bold text-fg">
                Motivo
              </label>
              <textarea
                id={`cancel-${id}`}
                rows={3}
                maxLength={REASON_MAX}
                className={`${FIELD} resize-y`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onBlur={() => setTouched(true)}
                aria-invalid={touched && invalid}
                disabled={pending}
              />
              {touched && invalid ? (
                <p role="alert" className="text-sm text-danger">{`Escribe un motivo de 1 a ${REASON_MAX} caracteres.`}</p>
              ) : null}
            </div>
            <ErrorLine error={error} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Volver
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
                Cancelar sorteo
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
