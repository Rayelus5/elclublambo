"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n";
import { refreshVouchAction } from "@/lib/vouches/actions";

/**
 * «Actualizar» (P5-R5b): re-reads one stored vouch on chain, so a revocation made outside the app (easscan, another dApp)
 * leaves the counts. No session needed; the server limits it by IP.
 */
export function RefreshButton({ uid, t }: { uid: string; t: Dictionary["vouches"] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function refresh() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const r = await refreshVouchAction(uid);
    setBusy(false);
    if (r.ok) {
      setMessage({ ok: true, text: t.summary.refreshed });
      if (r.state !== "active") router.refresh();
    } else setMessage({ ok: false, text: t.form.errors[r.error] ?? t.form.errors.unknown });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" variant="ghost" size="sm" onClick={refresh} disabled={busy}>
        {busy ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <RotateCw aria-hidden />}
        {t.summary.refresh}
      </Button>
      <div aria-live="polite">{message ? <p className={message.ok ? "text-sm text-fg-muted" : "text-sm text-danger"}>{message.text}</p> : null}</div>
    </div>
  );
}
