"use client";

import { useRef, useState } from "react";
import { CircleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatParticipaciones, formatUsdc } from "@/lib/treasury/format";
import { requestWithdrawalAction } from "@/lib/treasury/withdrawal-actions";
import { estimateUsdc, parsePercent, sharesForBps } from "@/lib/treasury/withdrawals";

const MIN_USDC = 1_000_000n;
const DEFAULT_PERCENT = "50";

/** bps (1..10000) -> "12,5" (decimal comma, no trailing zeros), the text field's own format. */
function percentText(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole},${frac}` : String(whole);
}

/**
 * Asks to withdraw a percentage of the viewer's participaciones. The shares lock at once; the USDC amount is only an
 * estimate at today's value, fixed when a treasurer approves.
 */
export function WithdrawDialog({
  open,
  onOpenChange,
  myShares,
  sharePriceUsd6,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  myShares: bigint;
  sharePriceUsd6: bigint;
}) {
  const [text, setText] = useState(DEFAULT_PERCENT);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const bps = parsePercent(text);
  const shares = bps === null ? 0n : sharesForBps(myShares, bps);
  const valid = bps !== null && shares > 0n;
  const estimate = valid ? estimateUsdc(shares, sharePriceUsd6) : null;

  async function submit() {
    if (!valid || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const r = await requestWithdrawalAction({ shares: shares.toString() });
      if (r.ok) onOpenChange(false);
      else setError(r.error);
    } catch {
      setError("No se pudo enviar la solicitud. Inténtalo de nuevo.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retirar participaciones</DialogTitle>
          <DialogDescription>
            Tienes {formatParticipaciones(myShares)}. Elige qué parte quieres retirar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="withdraw-range">Porcentaje a retirar</Label>
            <input
              id="withdraw-range"
              type="range"
              min={1}
              max={100}
              step={1}
              value={bps === null ? 1 : bps / 100}
              onChange={(e) => setText(percentText(Math.round(Number(e.target.value) * 100)))}
              className="h-11 w-full cursor-pointer accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="withdraw-percent">Porcentaje (%)</Label>
            <Input
              id="withdraw-percent"
              inputMode="decimal"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-invalid={!valid}
              aria-describedby="withdraw-estimate"
              className="font-mono"
            />
          </div>

          <div id="withdraw-estimate" className="flex flex-col gap-1 text-sm">
            {valid && estimate !== null ? (
              <>
                <p className="text-fg-muted">{formatParticipaciones(shares)}</p>
                <p className="text-fg">
                  {`≈ ${formatUsdc(estimate)} al valor actual. El importe final se fija cuando el tesorero aprueba la retirada.`}
                </p>
                {estimate < MIN_USDC && bps !== 10000 ? (
                  <p className="text-warning">La retirada mínima es de 1 USDC, salvo que retires todas tus participaciones.</p>
                ) : null}
              </>
            ) : (
              <p className="text-fg-muted">Escribe un porcentaje entre 0,01 y 100.</p>
            )}
          </div>

          <p className="rounded-control border border-border bg-surface-2 p-3 text-sm text-fg">
            Tus participaciones quedan bloqueadas desde que confirmas: dejan de contar para los canales con candado. Las retiradas
            dependen de la disponibilidad y de la decisión del tesorero.
          </p>

          {error ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-danger">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          ) : null}

          <Button onClick={submit} disabled={!valid || pending}>
            {pending ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
            Pedir retirada
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
