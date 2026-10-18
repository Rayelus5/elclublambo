"use client";

import { useEffect, useState } from "react";
import { TipList } from "@/components/payments/tip-list";
import { getMessageTips, type TipEntry } from "@/lib/payments/queries";
import { createBrowserClient } from "@/lib/supabase/browser";

/** Content of the badge popover: loads the donors when it opens. */
export function TipsPopover({ messageId }: { messageId: string }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; entries: TipEntry[] }>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const entries = await getMessageTips(createBrowserClient(), messageId);
        if (!cancelled) setState({ status: "ready", entries });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messageId]);

  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-display text-sm font-bold text-fg">Quién ha recompensado</h2>
      {state.status === "loading" ? (
        <p role="status" className="py-2 text-sm text-fg-muted">
          Cargando…
        </p>
      ) : state.status === "error" ? (
        <p role="alert" className="py-2 text-sm text-danger">
          No se pudo cargar la lista. Inténtalo de nuevo.
        </p>
      ) : state.entries.length === 0 ? (
        <p className="py-2 text-sm text-fg-muted">Todavía no hay propinas.</p>
      ) : (
        <TipList entries={state.entries} />
      )}
      <p className="border-t border-border pt-2 text-[13px] text-fg-muted">
        Anónimo solo lo es dentro del foro: la blockchain es pública y cualquiera puede rastrear la transacción.
      </p>
    </div>
  );
}
