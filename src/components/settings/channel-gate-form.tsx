"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setChannelGateAction } from "@/lib/channels/actions";
import { gatePercentToBps } from "@/lib/channels/lock";
import type { ChannelGate } from "@/lib/channels/tree";
import { rpcErrorMessage } from "@/lib/errors";
import { formatAmount, parseAmount } from "@/lib/payments/amounts";
import { cn } from "@/lib/utils";

const SCOPES: { value: ChannelGate["scope"]; label: string }[] = [
  { value: "view", label: "Ver el canal" },
  { value: "post", label: "Escribir" },
];
const NET_MAX = 10n ** 30n;
const SHARE_ERROR = "Escribe un porcentaje entre 0 y 100, con hasta 2 decimales.";
const NET_ERROR = "Escribe un importe en USDC de 0 en adelante, con hasta 6 decimales.";

/** 150 -> "1,5" (sin el símbolo %, el campo ya lo dice). */
function bpsToInput(bps: number): string {
  const frac = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return `${Math.floor(bps / 100)}${frac ? `,${frac}` : ""}`;
}

type Props = {
  channelId: string;
  /** Candado actual del canal; sin él, el canal está abierto. */
  gate?: ChannelGate;
  /** Se llama tras guardar con éxito. */
  onSaved?: () => void;
};

/**
 * Editor del candado de la DAO de un canal: % mínimo y/o aportación neta mínima (unidos con "o") y a qué se aplica.
 * Vacío en ambos campos quita el candado. No es un <form>: vive dentro del formulario del canal.
 */
export function ChannelGateForm({ channelId, gate, onSaved }: Props) {
  const router = useRouter();
  const uid = useId();
  const [share, setShare] = useState(gate?.minShareBps != null ? bpsToInput(gate.minShareBps) : "");
  const [net, setNet] = useState(gate?.minNetUsdc != null ? formatAmount(BigInt(gate.minNetUsdc), "USDC") : "");
  const [scope, setScope] = useState<ChannelGate["scope"]>(gate?.scope ?? "view");
  const [shareError, setShareError] = useState<string | null>(null);
  const [netError, setNetError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    let bps: number | null = null;
    let units: bigint | null = null;
    let bad = false;
    if (share.trim() !== "") {
      bps = gatePercentToBps(share);
      if (bps === null) bad = true;
    }
    setShareError(share.trim() !== "" && bps === null ? SHARE_ERROR : null);
    if (net.trim() !== "") {
      units = parseAmount(net, "USDC");
      if (units === null || units > NET_MAX) {
        units = null;
        bad = true;
        setNetError(NET_ERROR);
      } else setNetError(null);
    } else setNetError(null);
    if (bad) return;

    startTransition(async () => {
      const res = await setChannelGateAction({
        id: channelId,
        minShareBps: bps,
        minNetUsdc: units === null ? null : units.toString(),
        scope,
      });
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
        Candado de la DAO
      </legend>
      <p className="text-[13px] text-fg-muted">
        Pide un mínimo de la DAO a quien quiera entrar o escribir. Si rellenas los dos, basta con cumplir uno. Déjalos
        vacíos para quitar el candado.
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${uid}-share`}>% mínimo de la DAO</Label>
        <Input
          id={`${uid}-share`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="Ej. 1 o 0,25"
          value={share}
          onChange={(e) => {
            setShare(e.target.value);
            setShareError(null);
            setSaved(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          aria-invalid={shareError !== null}
          aria-describedby={shareError ? `${uid}-share-error` : undefined}
          disabled={pending}
        />
        {shareError ? (
          <p id={`${uid}-share-error`} role="alert" className="text-[13px] text-danger">
            {shareError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${uid}-net`}>Aportación neta mínima (USDC)</Label>
        <Input
          id={`${uid}-net`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="Ej. 100"
          value={net}
          onChange={(e) => {
            setNet(e.target.value);
            setNetError(null);
            setSaved(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          aria-invalid={netError !== null}
          aria-describedby={netError ? `${uid}-net-error` : undefined}
          disabled={pending}
        />
        {netError ? (
          <p id={`${uid}-net-error`} role="alert" className="text-[13px] text-danger">
            {netError}
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
                scope === s.value ? "bg-accent text-bg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
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
