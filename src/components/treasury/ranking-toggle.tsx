"use client";

import { useState, useTransition } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { setRankingVisibleAction } from "@/lib/treasury/actions";

/** Privacy first: members are "Anónimo" in the DAO ranking and history until they opt in. Their % still counts for gating. */
export function RankingToggle({ initial, id = "dao-ranking-visible" }: { initial: boolean; id?: string }) {
  const [visible, setVisible] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function change(next: boolean) {
    const previous = visible;
    setVisible(next);
    setError(null);
    start(async () => {
      try {
        const r = await setRankingVisibleAction(next);
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
          Aparecer con mi nombre en el ranking de la DAO
        </label>
      </div>
      <p className="text-[13px] text-fg-muted">Si lo dejas sin marcar, apareces como «Anónimo». Tu porcentaje cuenta igualmente para abrir canales con candado.</p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
