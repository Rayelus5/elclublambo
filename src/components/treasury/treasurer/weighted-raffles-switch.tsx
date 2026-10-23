"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { LegacyChainId } from "@/lib/legacy/linea";
import { setWeightedRafflesEnabledAction } from "@/lib/treasury/raffle-actions";
import { cn } from "@/lib/utils";

const NETWORKS: { chain: LegacyChainId; label: string; hint?: string }[] = [
  { chain: 59144, label: "Sorteos ponderados en Linea", hint: "Recomendado solo tras una revisión legal." },
  { chain: 59141, label: "Sorteos ponderados en Linea Sepolia" },
];

/** SuperAdmin's per-network switch. It gates creating weighted raffles only; existing ones keep their mode. */
export function WeightedRafflesSwitch({ enabled }: { enabled: Record<LegacyChainId, boolean> }) {
  const router = useRouter();
  const [state, setState] = useState(enabled);
  // Re-sync when the server's values change (a refresh, or another SuperAdmin flipping it): adjust during render.
  const signature = `${enabled[59144]}|${enabled[59141]}`;
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setState(enabled);
  }
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<LegacyChainId | null>(null);
  const [errors, setErrors] = useState<Partial<Record<LegacyChainId, string>>>({});
  const inFlight = useRef(false);

  /** Turning mainnet ON asks first: weighted raffles move real money by participaciones. */
  function onClick(chain: LegacyChainId) {
    if (chain === 59144 && !state[chain]) setConfirming(true);
    else void toggle(chain);
  }

  async function toggle(chain: LegacyChainId) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(chain);
    setErrors((e) => ({ ...e, [chain]: undefined }));
    const next = !state[chain];
    try {
      const r = await setWeightedRafflesEnabledAction(chain, next);
      if (r.ok) {
        setState((s) => ({ ...s, [chain]: next }));
        router.refresh();
      } else {
        setErrors((e) => ({ ...e, [chain]: r.error }));
      }
    } catch {
      setErrors((e) => ({ ...e, [chain]: "No se pudo cambiar el interruptor. Inténtalo de nuevo." }));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  return (
    <>
      <ul className="flex flex-col divide-y divide-border">
        {NETWORKS.map(({ chain, label, hint }) => {
          const on = state[chain];
          const id = `weighted-raffles-switch-${chain}`;
          return (
            <li key={chain} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span id={`${id}-label`} className="text-sm font-bold text-fg">
                    {label}
                  </span>
                  {hint ? (
                    <span id={`${id}-hint`} className="text-[13px] text-fg-muted">
                      {hint}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-[13px] font-bold text-fg-muted">{on ? "Activados" : "Desactivados"}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-labelledby={`${id}-label`}
                    aria-describedby={hint ? `${id}-hint` : undefined}
                    disabled={busy !== null}
                    onClick={() => onClick(chain)}
                    className="relative inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "relative block h-6 w-11 rounded-full border transition-colors duration-150 motion-reduce:transition-none",
                        on ? "border-accent bg-accent" : "border-border-strong bg-surface-2",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 left-0.5 flex size-4 items-center justify-center rounded-full bg-fg transition-transform duration-150 motion-reduce:transition-none",
                          on ? "translate-x-5 bg-bg" : "",
                        )}
                      >
                        {busy === chain ? <Loader2 className="size-3 animate-spin text-bg motion-reduce:animate-none" /> : null}
                      </span>
                    </span>
                  </button>
                </div>
              </div>
              {errors[chain] ? (
                <p role="alert" className="flex items-start gap-2 text-sm break-words text-danger">
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {errors[chain]}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activar sorteos ponderados en Linea</DialogTitle>
            <DialogDescription>
              Los tesoreros podrán crear sorteos con premios reales cuyas probabilidades dependen de las participaciones. Recomendado solo tras una revisión legal. Puedes
              desactivarlo después; los sorteos ya creados se mantienen.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setConfirming(false);
                void toggle(59144);
              }}
            >
              Activar sorteos ponderados
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
