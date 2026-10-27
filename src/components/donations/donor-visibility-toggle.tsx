"use client";

import { useState, useTransition } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { setDonorVisibleAction } from "@/lib/donations/actions";

/** Opt-out of the donor list (P1-R2, on by default). Hidden or not, the donations still count for Mecenas and padlocks. */
export function DonorVisibilityToggle({ initial, id = "donor-visible" }: { initial: boolean; id?: string }) {
  const [visible, setVisible] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function change(next: boolean) {
    const previous = visible;
    setVisible(next);
    setError(null);
    start(async () => {
      try {
        const r = await setDonorVisibleAction(next);
        if (!r.ok) {
          setVisible(previous);
          setError(r.error);
        }
      } catch {
        setVisible(previous);
        setError("No se pudo guardar el cambio. Inténtalo de nuevo.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <Checkbox id={id} checked={visible} disabled={pending} onCheckedChange={(v) => change(v === true)} />
        <label htmlFor={id} className="min-h-11 flex-1 content-center text-sm font-bold text-fg">
          Aparecer en la lista de donantes
        </label>
      </div>
      <p className="text-[13px] text-fg-muted">Si lo desmarcas, los demás no te ven en la lista. Lo que donaste sigue contando.</p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
