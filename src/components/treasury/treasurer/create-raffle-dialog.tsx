"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WETH_NOTE } from "@/components/treasury/raffles/raffle-notes";
import { rpcErrorMessage } from "@/lib/errors";
import { createRaffleAction } from "@/lib/treasury/raffle-actions";
import { formatBps } from "@/lib/treasury/format";
import { parsePrize, type PrizeToken, type RaffleMode } from "@/lib/treasury/raffles";

const MAX_TITLE = 80;
const WEIGHTED_OFF = "Los sorteos ponderados no están activados en esta red.";

/** Share-value drop, in basis points, a prize causes: prize USD · 10000 / NAV. Null when it cannot be estimated. */
function dropBps(prize: bigint | null, token: PrizeToken, navUsd6: bigint, ethPriceE8: bigint | null): bigint | null {
  if (prize === null || prize <= 0n || navUsd6 <= 0n) return null;
  let usd6: bigint;
  if (token === "USDC") usd6 = prize;
  else if (ethPriceE8 !== null && ethPriceE8 > 0n) usd6 = (prize * ethPriceE8) / 10n ** 20n;
  else return null;
  return (usd6 * 10_000n) / navUsd6;
}

const radioClass = "size-5 shrink-0 accent-[var(--color-accent)] outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
const optionClass = "flex min-h-11 cursor-pointer items-center gap-2 text-sm text-fg has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50";

/**
 * Treasurer's «Crear sorteo». The fund is billed from creation (the share value drops by the prize): the form says so
 * with an estimate before submitting. The close is sent as ISO (the browser's zone resolved here, never on the server).
 */
export function CreateRaffleDialog({
  weightedEnabled,
  navUsd6,
  ethPriceE8,
}: {
  weightedEnabled: boolean;
  navUsd6: bigint;
  ethPriceE8: bigint | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button className="self-start" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        Crear sorteo
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Crear sorteo</DialogTitle>
            <DialogDescription>El ganador se elige solo al cerrar, con un resultado que cualquiera puede comprobar.</DialogDescription>
          </DialogHeader>
          {/* Mounted only while open: every opening starts from an empty form. */}
          <CreateBody weightedEnabled={weightedEnabled} navUsd6={navUsd6} ethPriceE8={ethPriceE8} onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateBody({
  weightedEnabled,
  navUsd6,
  ethPriceE8,
  onClose,
}: {
  weightedEnabled: boolean;
  navUsd6: bigint;
  ethPriceE8: bigint | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const uid = useId();
  const [title, setTitle] = useState("");
  const [token, setToken] = useState<PrizeToken>("USDC");
  const [prize, setPrize] = useState("");
  const [closes, setCloses] = useState("");
  const [chosenMode, setMode] = useState<RaffleMode>("equal");
  // The switch can go off while the dialog is open: weighted then falls back to equal (SQL would refuse it anyway).
  const mode: RaffleMode = weightedEnabled ? chosenMode : "equal";
  const [error, setError] = useState<string | null>(null);
  const [commit, setCommit] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const amount = parsePrize(prize.trim(), token);
  const bps = dropBps(amount, token, navUsd6, ethPriceE8);
  const ready = title.trim() !== "" && prize.trim() !== "" && closes !== "";

  async function submit() {
    if (inFlight.current) return;
    if (title.trim().length === 0 || title.trim().length > MAX_TITLE) return setError(rpcErrorMessage("title_required"));
    if (amount === null || amount <= 0n) {
      return setError(token === "USDC" ? "Escribe un premio válido, con hasta 6 decimales." : "Escribe un premio válido, con hasta 18 decimales.");
    }
    const when = new Date(closes);
    if (Number.isNaN(when.getTime())) return setError(rpcErrorMessage("closes_at_invalid"));
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const r = await createRaffleAction({ title: title.trim(), prizeToken: token, prize: prize.trim(), closesAt: when.toISOString(), mode });
      if (r.ok) {
        setCommit(r.commit);
        router.refresh();
      } else {
        setError(r.error);
      }
    } catch {
      setError("No se pudo crear el sorteo. Inténtalo de nuevo.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  if (commit !== null) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="flex items-start gap-2 text-sm text-success">
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 break-all">{`Sorteo creado. Su compromiso ya es público: ${commit}`}</span>
        </p>
        <Button variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${uid}-title`}>Título</Label>
        <Input id={`${uid}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={MAX_TITLE} autoComplete="off" disabled={pending} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${uid}-prize`}>Premio</Label>
        <Input
          id={`${uid}-prize`}
          value={prize}
          onChange={(e) => setPrize(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          placeholder={token === "USDC" ? "50" : "0,05"}
          disabled={pending}
        />
        <fieldset className="flex flex-wrap gap-x-6" disabled={pending}>
          <legend className="sr-only">Token del premio</legend>
          {(["USDC", "WETH"] as const).map((t) => (
            <label key={t} className={optionClass}>
              <input type="radio" name={`${uid}-token`} value={t} checked={token === t} onChange={() => setToken(t)} className={radioClass} />
              {t}
            </label>
          ))}
        </fieldset>
        {token === "WETH" ? <p className="text-[13px] text-fg-muted">{WETH_NOTE}</p> : null}
        <p className="text-[13px] text-fg-muted">
          {bps !== null
            ? `El premio se reserva del fondo desde ahora: el valor de cada participación baja ≈ ${formatBps(Number(bps))}. No cambia el % de nadie.`
            : "El premio se reserva del fondo desde ahora: el valor de cada participación baja. No cambia el % de nadie."}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${uid}-closes`}>Cierre</Label>
        <Input
          id={`${uid}-closes`}
          type="datetime-local"
          value={closes}
          onChange={(e) => setCloses(e.target.value)}
          aria-describedby={`${uid}-closes-help`}
          disabled={pending}
        />
        <span id={`${uid}-closes-help`} className="text-[13px] text-fg-muted">
          Entre 1 hora y 30 días desde ahora.
        </span>
      </div>

      <fieldset className="flex flex-col" disabled={pending}>
        <legend className="mb-1 text-sm font-bold text-fg">Modo</legend>
        <label className={optionClass}>
          <input type="radio" name={`${uid}-mode`} value="equal" checked={mode === "equal"} onChange={() => setMode("equal")} className={radioClass} />
          Igualitario
        </label>
        <label className={optionClass}>
          <input
            type="radio"
            name={`${uid}-mode`}
            value="weighted"
            checked={mode === "weighted"}
            disabled={!weightedEnabled}
            onChange={() => setMode("weighted")}
            aria-describedby={weightedEnabled ? undefined : `${uid}-weighted-off`}
            className={radioClass}
          />
          Ponderado por participación
        </label>
        {!weightedEnabled ? (
          <span id={`${uid}-weighted-off`} className="text-[13px] text-fg-muted">
            {WEIGHTED_OFF}
          </span>
        ) : null}
      </fieldset>

      {error ? (
        <p role="alert" className="flex items-start gap-2 text-sm break-words text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={!ready || pending}>
        {pending ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
        Crear sorteo
      </Button>
    </form>
  );
}
