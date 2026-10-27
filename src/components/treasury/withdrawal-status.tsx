"use client";

import { useRef, useState } from "react";
import { CircleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { legacyExplorerTx, type LegacyChainId } from "@/lib/legacy/linea";
import { formatParticipaciones, formatUsdc } from "@/lib/treasury/format";
import { cancelWithdrawalAction } from "@/lib/treasury/withdrawal-actions";
import { withdrawalLabel, type MyWithdrawal } from "@/lib/treasury/withdrawals";

const linkClass =
  "inline-flex min-h-11 items-center rounded-control text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso)) + " UTC";

/** The viewer's latest withdrawal request in words: the status is always text (never only color), with what they can do next. */
export function WithdrawalStatus({ withdrawal: w, chainId }: { withdrawal: MyWithdrawal; chainId: LegacyChainId }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const approvedWaiting = w.status === "approved" && !w.payoutRecorded;
  const canCancel = w.status === "pending";
  const locked = w.status === "pending" || w.status === "approved";
  // "Aprobada" carries the fixed USDC amount; the finality label follows once the payout is recorded.
  const headline =
    approvedWaiting && w.amountUsdc !== null
      ? `Aprobada · importe fijado: ${formatUsdc(w.amountUsdc)}`
      : w.status === "rejected" && w.rejectReason
        ? `Rechazada: ${w.rejectReason}`
        : withdrawalLabel(w);
  const tone =
    w.status === "paid" ? "border-success" : w.status === "rejected" ? "border-danger" : w.lastExpiredAt && w.status === "pending" ? "border-warning" : "border-border-strong";

  async function cancel() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const r = await cancelWithdrawalAction(w.id);
      if (!r.ok) setError(r.error);
    } catch {
      setError("No se pudo cancelar la solicitud. Inténtalo de nuevo.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div data-testid="withdrawal-status" className={`flex flex-col gap-2 rounded-control border-l-4 bg-surface-2 p-3 ${tone}`}>
      <p className="text-sm text-fg-muted">Tu retirada</p>
      <p className="font-bold break-words text-fg">{headline}</p>
      {locked ? <p className="text-[13px] text-fg-muted">{`${formatParticipaciones(w.shares)} bloqueadas`}</p> : null}
      {w.status === "approved" && w.payoutRecorded && w.amountUsdc !== null ? (
        <p className="text-[13px] text-fg-muted">{`Importe fijado: ${formatUsdc(w.amountUsdc)}`}</p>
      ) : null}
      {approvedWaiting && w.expiresAt ? <p className="text-[13px] text-fg-muted">{`Caduca el ${dateTime(w.expiresAt)}`}</p> : null}
      {w.status === "paid" && w.amountUsdc !== null ? <p className="text-[13px] text-fg-muted">{`Importe fijado: ${formatUsdc(w.amountUsdc)}`}</p> : null}
      {w.payoutTxHash && (w.status === "paid" || w.status === "approved") ? (
        <a
          href={legacyExplorerTx(chainId, w.payoutTxHash)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${linkClass} self-start`}
        >
          Ver el pago en el explorador
        </a>
      ) : null}
      {canCancel ? (
        <Button variant="outline" onClick={cancel} disabled={pending} className="self-start">
          {pending ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
          Cancelar solicitud
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
