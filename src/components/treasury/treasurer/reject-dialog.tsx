"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { rejectWithdrawalAction } from "@/lib/treasury/withdrawal-actions";

const MAX_REASON = 280;

/**
 * Rejects a withdrawal with a reason the member will read. SQL refuses to reject an approved request while a detected
 * payout waits for verification (ruling F4c-R3): that refusal is explained here instead of the generic copy.
 */
export function RejectDialog({
  requestId,
  approved = false,
  open,
  onOpenChange,
}: {
  requestId: string;
  /** The request is approved (its payout may be on its way). */
  approved?: boolean;
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
      const r = await rejectWithdrawalAction(requestId, reason);
      if (r.ok) {
        onOpenChange(false);
        router.refresh();
      } else if (r.code === "invalid_state" && approved) {
        setError("Hay un pago detectado pendiente de verificar: no se puede rechazar hasta que se verifique o se descarte. Si la retirada ya cambió, recarga la página.");
      } else {
        setError(r.error);
      }
    } catch {
      setError("No se pudo rechazar la retirada. Inténtalo de nuevo.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Rechazar retirada</DialogTitle>
          <DialogDescription>El miembro verá el motivo y sus participaciones se desbloquearán.</DialogDescription>
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
            Rechazar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
