"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Loader2 } from "lucide-react";
import { AdminConfirm } from "@/components/admin/admin-confirm";
import { setSwitchAction } from "@/lib/admin/actions";
import { SWITCH_LABELS } from "@/lib/admin/labels";
import { SWITCH_KEYS, type SwitchKey } from "@/lib/admin/state";
import { rpcErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

function offText(key: SwitchKey): string {
  // Registration has no page: a closed registration is not a «No disponible» notice but a refused sign-up.
  if (key === "registration") return "Las wallets nuevas no podrán crear cuenta hasta que lo actives.";
  return "Los visitantes verán «No disponible» hasta que lo actives.";
}

/** One switch per public tool or function. Turning one off asks first (A-R18); turning it on does not. */
export function ToolSwitches({ switches }: { switches: Record<SwitchKey, boolean> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<SwitchKey | null>(null);
  // The key outlives `confirmOpen` so the dialog keeps its text while it closes.
  const [confirmKey, setConfirmKey] = useState<SwitchKey | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<SwitchKey, string>>>({});
  const [, startTransition] = useTransition();

  function apply(key: SwitchKey, enabled: boolean) {
    setBusy(key);
    setErrors((e) => ({ ...e, [key]: undefined }));
    startTransition(async () => {
      const res = await setSwitchAction(key, enabled);
      setBusy(null);
      if (!res.ok) {
        setErrors((e) => ({ ...e, [key]: rpcErrorMessage(res.error) }));
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <ul className="flex flex-col divide-y divide-border rounded-panel border border-border bg-surface px-4">
        {SWITCH_KEYS.map((key) => {
          const enabled = switches[key];
          const id = `admin-switch-${key}`;
          return (
            <li key={key} className="flex flex-col gap-2 py-2">
              <div className="flex items-center justify-between gap-4">
                <span id={`${id}-label`} className="min-w-0 text-sm font-bold break-words text-fg">
                  {SWITCH_LABELS[key]}
                </span>
                <div className="flex shrink-0 items-center gap-3">
                  <span className={cn("text-[13px] font-bold", enabled ? "text-fg" : "text-fg-muted")}>
                    {enabled ? "Activo" : "Desactivado"}
                  </span>
                  <button
                    id={id}
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-labelledby={`${id}-label`}
                    disabled={busy !== null}
                    onClick={() => {
                      if (!enabled) return apply(key, true);
                      setConfirmKey(key);
                      setConfirmOpen(true);
                    }}
                    className="relative inline-flex min-h-11 w-14 shrink-0 cursor-pointer items-center justify-center rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "relative block h-6 w-11 rounded-full border transition-colors duration-150 motion-reduce:transition-none",
                        enabled ? "border-accent bg-accent" : "border-border-strong bg-surface-2",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 left-0.5 flex size-4 items-center justify-center rounded-full bg-fg transition-transform duration-150 motion-reduce:transition-none",
                          enabled ? "translate-x-5 bg-bg" : "",
                        )}
                      >
                        {busy === key ? <Loader2 className="size-3 animate-spin text-bg motion-reduce:animate-none" /> : null}
                      </span>
                    </span>
                  </button>
                </div>
              </div>
              {errors[key] ? (
                <p role="alert" className="flex items-start gap-2 text-sm break-words text-danger">
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {errors[key]}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <AdminConfirm
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={confirmKey ? `¿Desactivar «${SWITCH_LABELS[confirmKey]}»?` : ""}
        description={confirmKey ? offText(confirmKey) : ""}
        onConfirm={() => {
          if (confirmKey) apply(confirmKey, false);
        }}
      />
    </>
  );
}
