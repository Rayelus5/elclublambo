"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cancelRaffleAction } from "@/lib/treasury/raffle-actions";
import { formatPrize, type TreasuryRaffle } from "@/lib/treasury/raffles";

const MAX_REASON = 280;

/** Cancels an open or closed raffle with a public reason; the prize goes back to the fund (SQL refuses a drawn one). */
export function CancelRaffleDialog({
  raffle,
  open,
  onOpenChange,
}: {
  raffle: Pick<TreasuryRaffle, "id" | "title" | "prizeToken" | "prizeAmount">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const id = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const reason = text.trim();

  async function submit() {
    if (!reason || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const r = await cancelRaffleAction(raffle.id, reason);
      if (r.ok) {
        onOpenChange(false);
        router.refresh();
      } else {
        setError(r.error);
      }
    } catch {
      setError("No se pudo cancelar el sorteo. Inténtalo de nuevo.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cancelar sorteo</DialogTitle>
          <DialogDescription>
            {`«${raffle.title}»: el premio de ${formatPrize(raffle.prizeAmount, raffle.prizeToken)} vuelve al fondo y los participantes verán el motivo.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={id}>Motivo</Label>
            <textarea
              id={id}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={MAX_REASON}
              rows={3}
              disabled={pending}
              aria-describedby={`${id}-count`}
              className="min-h-24 w-full resize-y rounded-control border border-border-strong bg-surface px-3 py-2 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
            />
            <span id={`${id}-count`} className="self-end text-[13px] text-fg-muted">
              {text.length}/{MAX_REASON}
            </span>
          </div>
          {error ? (
            <p role="alert" className="flex items-start gap-2 text-sm break-words text-danger">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          ) : null}
          <Button variant="destructive" onClick={submit} disabled={!reason || pending}>
            {pending ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
            Cancelar sorteo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
