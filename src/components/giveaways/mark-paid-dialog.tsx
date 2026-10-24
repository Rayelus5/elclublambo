"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import { markPrizePaidAction } from "@/lib/giveaways/actions";

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * «Marcar pagado» of a USDC prize: the treasurer pays it from the Safe and pastes the hash. The server checks the
 * Transfer on chain (from the Safe, to the winner's wallet, the exact amount) before it records anything.
 */
export function MarkPaidButton({
  prizeId,
  label,
  chainId,
  winnerAddress,
}: {
  prizeId: string;
  label: string;
  chainId: ChainId;
  winnerAddress: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Marcar pagado
      </Button>
      {open ? <MarkPaidDialog onOpenChange={setOpen} prizeId={prizeId} label={label} chainId={chainId} winnerAddress={winnerAddress} /> : null}
    </>
  );
}

function MarkPaidDialog({
  onOpenChange,
  prizeId,
  label,
  chainId,
  winnerAddress,
}: {
  onOpenChange(open: boolean): void;
  prizeId: string;
  label: string;
  chainId: ChainId;
  winnerAddress: string | null;
}) {
  const router = useRouter();
  const [hash, setHash] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const invalid = !HASH_RE.test(hash.trim());
  const shown = touched && invalid ? "El hash empieza por 0x y tiene 64 caracteres." : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    setError(null);
    start(async () => {
      try {
        const r = await markPrizePaidAction(prizeId, hash.trim());
        if (!r.ok) return setError(r.error);
        router.refresh();
        onOpenChange(false);
      } catch {
        setError("No se pudo comprobar el pago. Inténtalo de nuevo.");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold">Marcar pagado</DialogTitle>
          <DialogDescription>{`Envía ${label} desde la Safe en ${NETWORKS[chainId].name} y pega el hash. Se comprueba en la red antes de guardarlo.`}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {winnerAddress ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-bold text-fg">Wallet del ganador</span>
              <span className="font-mono text-[13px] break-all">{winnerAddress}</span>
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <label htmlFor={`paid-hash-${prizeId}`} className="text-sm font-bold text-fg">
              Hash de la transacción
            </label>
            <Input
              id={`paid-hash-${prizeId}`}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              value={hash}
              onChange={(e) => setHash(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={!!shown}
              aria-describedby={shown ? `paid-hash-${prizeId}-error` : undefined}
              disabled={pending}
            />
            {shown ? (
              <p id={`paid-hash-${prizeId}-error`} role="alert" className="text-sm text-danger">
                {shown}
              </p>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="rounded-control border border-danger p-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
              {pending ? "Comprobando…" : "Marcar pagado"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
