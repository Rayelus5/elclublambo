"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setChannelGateAction } from "@/lib/channels/actions";
import type { ChannelGate } from "@/lib/channels/tree";
import { rpcErrorMessage } from "@/lib/errors";
import { formatAmount, parseAmount } from "@/lib/payments/amounts";
import { cn } from "@/lib/utils";

const SCOPES: { value: ChannelGate["scope"]; label: string }[] = [
  { value: "view", label: "Ver el canal" },
  { value: "post", label: "Escribir" },
];
const USD_ERROR = "Escribe un importe en USD de 0 en adelante, con hasta 2 decimales.";
const USD_FORMAT = /^\d+(?:[.,]\d{1,2})?$/;

type Props = {
  channelId: string;
  /** Candado actual del canal; sin él, el canal está abierto. */
  gate?: ChannelGate;
  /** Se llama tras guardar con éxito. */
  onSaved?: () => void;
};

/**
 * Editor del candado de un canal: lo que hay que haber donado (USD) para ver o escribir. Vacío quita el candado.
 * No es un <form>: vive dentro del formulario del canal.
 */
export function ChannelGateForm({ channelId, gate, onSaved }: Props) {
  const router = useRouter();
  const uid = useId();
  const [amount, setAmount] = useState(
    gate?.minDonatedUsd6 != null ? formatAmount(BigInt(gate.minDonatedUsd6), "USDC") : "",
  );
  const [scope, setScope] = useState<ChannelGate["scope"]>(gate?.scope ?? "view");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    const text = amount.trim();
    if (text !== "" && (!USD_FORMAT.test(text) || parseAmount(text, "USDC") === null)) {
      setAmountError(USD_ERROR);
      return;
    }
    setAmountError(null);

    startTransition(async () => {
      const res = await setChannelGateAction({ id: channelId, minDonatedUsd: text === "" ? null : text, scope });
      if (res.error) {
        setError(rpcErrorMessage(res.error));
        return;
      }
      setSaved(true);
      router.refresh();
      onSaved?.();
    });
  }

  return (
    <fieldset className="flex flex-col gap-4 rounded-panel border border-border p-4">
      <legend className="flex items-center gap-2 px-1 font-display text-base font-bold text-fg">
        <Lock className="size-4 text-fg-muted" aria-hidden />
        Candado por lo donado
      </legend>
      <p className="text-[13px] text-fg-muted">
        Pide un total donado a quien quiera entrar o escribir. Cuenta todo lo que ha donado, en cualquier red. Déjalo
        vacío para quitar el candado.
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${uid}-usd`}>Donado mínimo (USD)</Label>
        <Input
          id={`${uid}-usd`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="Ej. 10 o 2,5"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setAmountError(null);
            setSaved(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          aria-invalid={amountError !== null}
          aria-describedby={amountError ? `${uid}-usd-error` : undefined}
          disabled={pending}
        />
        {amountError ? (
          <p id={`${uid}-usd-error`} role="alert" className="text-[13px] text-danger">
            {amountError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <span id={`${uid}-scope`} className="text-sm font-medium text-fg">
          Aplicar a
        </span>
        <div
          role="radiogroup"
          aria-labelledby={`${uid}-scope`}
          className="grid grid-cols-2 gap-1 rounded-control border border-border-strong p-1"
        >
          {SCOPES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={scope === s.value}
              disabled={pending}
              onClick={() => {
                setScope(s.value);
                setSaved(false);
              }}
              className={cn(
                "min-h-11 rounded-control text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50",
                scope === s.value ? "bg-accent-fill text-accent-fill-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-control border border-danger px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      <p aria-live="polite" className="min-h-5 text-[13px] text-success">
        {saved ? "Candado guardado" : ""}
      </p>

      <Button type="button" variant="secondary" className="self-start" disabled={pending} onClick={save}>
        {pending ? "Guardando…" : "Guardar candado"}
      </Button>
    </fieldset>
  );
}
