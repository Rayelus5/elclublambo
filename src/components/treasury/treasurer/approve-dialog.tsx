"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatUsdc } from "@/lib/treasury/format";
import { approveWithdrawalAction, quoteWithdrawalAction } from "@/lib/treasury/withdrawal-actions";

type Quote = { amountUsdc: bigint; availableUsdc: bigint; destination: string; selfApproval: boolean };

const DIGITS = /^\d{1,78}$/;

/** What approving would fix right now, then the approval itself. The amount comes from SQL; the treasurer cannot edit it. */
export function ApproveDialog({
  requestId,
  banned = false,
  open,
  onOpenChange,
}: {
  requestId: string;
  /** The member was banned after asking (ruling F4c-R2): they can still be paid, but the treasurer should know. */
  banned?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Aprobar retirada</DialogTitle>
          <DialogDescription>
            El importe se calcula al valor de mercado actual del fondo y queda fijado al aprobar. Después, paga desde la Safe.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open: the quote is read each time the dialog opens. */}
        <ApproveBody requestId={requestId} banned={banned} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ApproveBody({ requestId, banned, onClose }: { requestId: string; banned: boolean; onClose: () => void }) {
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvedAmount, setApprovedAmount] = useState<bigint | null>(null);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    let live = true;
    quoteWithdrawalAction(requestId)
      .then((r) => {
        if (!live) return;
        if (r.ok && DIGITS.test(r.quote.amountUsdc) && DIGITS.test(r.quote.availableUsdc)) {
          setQuote({
            amountUsdc: BigInt(r.quote.amountUsdc),
            availableUsdc: BigInt(r.quote.availableUsdc),
            destination: r.quote.destination,
            selfApproval: r.quote.selfApproval,
          });
        } else {
          setError(r.ok ? "No se pudo calcular el importe. Inténtalo de nuevo." : r.error);
        }
      })
      .catch(() => live && setError("No se pudo calcular el importe. Inténtalo de nuevo."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [requestId, attempt]);

  function retry() {
    setError(null);
    setLoading(true);
    setAttempt((n) => n + 1);
  }

  async function approve() {
    if (!quote || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const r = await approveWithdrawalAction(requestId);
      if (r.ok && DIGITS.test(r.amountUsdc)) {
        setApprovedAmount(BigInt(r.amountUsdc));
        router.refresh();
      } else {
        setError(r.ok ? "No se pudo aprobar la retirada. Inténtalo de nuevo." : r.error);
      }
    } catch {
      setError("No se pudo aprobar la retirada. Inténtalo de nuevo.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  if (approvedAmount !== null) {
    return (
      <div className="flex flex-col gap-4">
        <p className="flex items-start gap-2 text-sm text-success">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          {`Aprobada por ${formatUsdc(approvedAmount)}. Paga desde la Safe y luego pega el hash en «Marcar como pagada», o el foro detectará la transferencia.`}
        </p>
        <Button variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {loading ? (
        <p role="status" className="flex items-center gap-2 text-sm text-fg-muted">
          <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          Calculando el importe…
        </p>
      ) : null}
      {banned ? (
        <p className="flex items-start gap-2 text-sm text-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          Miembro baneado: pidió la retirada antes de que lo baneasen. Puede aprobarse y pagarse igualmente.
        </p>
      ) : null}
      {quote ? (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-fg">{`Importe que se fijará: ${formatUsdc(quote.amountUsdc)}`}</p>
          <p className="text-fg-muted">{`USDC disponible en la Safe: ${formatUsdc(quote.availableUsdc)}`}</p>
          <p className="text-fg-muted">
            Wallet de destino: <span className="font-mono break-all text-fg">{quote.destination}</span>
          </p>
          {quote.availableUsdc < quote.amountUsdc ? (
            <p className="flex items-start gap-2 text-warning">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              No hay USDC suficiente en la Safe: vende ETH antes de pagar.
            </p>
          ) : null}
          {quote.selfApproval ? (
            <p className="flex items-start gap-2 text-warning">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              Es tu propia retirada: quedará registrada y marcada en el panel.
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="flex items-start gap-2 text-sm break-words text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
      {!quote && !loading && !approvedAmount ? (
        <Button variant="secondary" onClick={retry}>
          Reintentar
        </Button>
      ) : null}
      <Button onClick={approve} disabled={!quote || pending}>
        {pending ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
        Aprobar y fijar importe
      </Button>
    </div>
  );
}
