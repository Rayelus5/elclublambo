"use client";

import { useState, useTransition } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import { reconcileNowAction } from "@/lib/treasury/actions";
import { formatUsdc } from "@/lib/treasury/format";

/** Amounts travel as text (numeric(78,0)). `diff` is the EFFECTIVE diff: onchain - ledger - pending finality. */
export type ReconcileRun = { ranAt: string; ledgerValue: string; pendingValue: string; onchainBalance: string; diff: string };

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso)) + " UTC";

function diffCopy(diff: bigint): string {
  if (diff > 0n) return "Hay fondos en la Safe que no están en el registro (transferencias directas)";
  if (diff < 0n) return "La Safe tiene menos de lo registrado";
  return "La Safe y el registro coinciden.";
}

/** Treasury managers only (MANAGE_TREASURY, bit 256): last run, what the difference means, and a button to run it now. */
export function ReconcilePanel({ perms, last }: { perms: bigint; last: ReconcileRun | null }) {
  const [run, setRun] = useState<ReconcileRun | null>(last);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!hasPerm(perms, Perm.MANAGE_TREASURY)) return null;

  function reconcile() {
    setError(null);
    start(async () => {
      try {
        const r = await reconcileNowAction();
        if (!r.ok) return setError(r.error);
        setRun({
          ranAt: new Date().toISOString(),
          ledgerValue: r.result.ledgerValue,
          pendingValue: r.result.pendingValue,
          onchainBalance: r.result.onchainBalance,
          diff: r.result.diff,
        });
      } catch {
        setError("No se pudo reconciliar. Inténtalo de nuevo.");
      }
    });
  }

  const diff = run ? BigInt(run.diff) : 0n;
  return (
    <section aria-labelledby="reconcile-title" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
      <h2 id="reconcile-title" className="text-h2">
        Reconciliación
      </h2>
      {run ? (
        <>
          <p className={`flex items-start gap-2 text-sm font-bold ${diff === 0n ? "text-success" : "text-warning"}`} aria-live="polite">
            {diff === 0n ? <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" /> : <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />}
            <span>{diffCopy(diff)}</span>
          </p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-control bg-surface-2 p-3 text-sm">
            <dt className="text-fg-muted">Último repaso</dt>
            <dd className="text-right text-fg">{dateTime(run.ranAt)}</dd>
            <dt className="text-fg-muted">Registro</dt>
            <dd className="text-right font-mono text-fg">{formatUsdc(BigInt(run.ledgerValue))}</dd>
            <dt className="text-fg-muted">Pendiente de finalización</dt>
            <dd className="text-right font-mono text-fg">{formatUsdc(BigInt(run.pendingValue))}</dd>
            <dt className="text-fg-muted">En la Safe</dt>
            <dd className="text-right font-mono text-fg">{formatUsdc(BigInt(run.onchainBalance))}</dd>
            <dt className="font-bold text-fg">Diferencia</dt>
            <dd className="text-right font-mono font-bold text-fg">{`${diff > 0n ? "+" : diff < 0n ? "−" : ""}${formatUsdc(diff < 0n ? -diff : diff)}`}</dd>
          </dl>
        </>
      ) : (
        <p className="text-sm text-fg-muted">Todavía no se ha reconciliado.</p>
      )}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button className="self-start" onClick={reconcile} disabled={pending}>
        {pending ? "Reconciliando…" : "Reconciliar ahora"}
      </Button>
    </section>
  );
}
