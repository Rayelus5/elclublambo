"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { markWithdrawalPaidAction } from "@/lib/treasury/withdrawal-actions";

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/** Verifies the hash of the Safe's USDC transfer on chain and records the payout; the shares burn later, at finality. */
export function MarkPaidDialog({
  requestId,
  open,
  onOpenChange,
}: {
  requestId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const id = useId();
  const [hash, setHash] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  async function submit() {
    if (inFlight.current) return;
    const value = hash.trim();
    if (!TX_HASH.test(value)) {
      setError("El hash debe empezar por 0x y tener 64 caracteres hexadecimales.");
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const r = await markWithdrawalPaidAction(requestId, value);
      if (r.ok) {
        setDone(true);
        router.refresh();
      } else {
        setError(r.error);
      }
    } catch {
      setError("No se pudo comprobar el pago. Inténtalo de nuevo.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Marcar como pagada</DialogTitle>
          <DialogDescription>
            Pega el hash de la transferencia de USDC que hiciste desde la Safe. Se comprueba en la red: importe, origen y destino. El
            pago debe ser una sola transferencia de al menos el importe fijado: no se admiten pagos repartidos en varias.
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="flex flex-col gap-4">
            <p className="flex items-start gap-2 text-sm text-success">
              <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
              Pago verificado. Las participaciones se quemarán cuando la red lo finalice.
            </p>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cerrar
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={id}>Hash de la transacción</Label>
              <Input
                id={id}
                value={hash}
                onChange={(e) => setHash(e.target.value)}
                placeholder="0x…"
                autoComplete="off"
                spellCheck={false}
                disabled={pending}
                aria-invalid={error !== null}
                className="font-mono"
              />
            </div>
            {error ? (
              <p role="alert" className="flex items-start gap-2 text-sm break-words text-danger">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                {error}
              </p>
            ) : null}
            <Button onClick={submit} disabled={pending || hash.trim() === ""}>
              {pending ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
              Comprobar pago
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
