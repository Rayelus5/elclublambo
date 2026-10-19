"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enterRaffleAction, leaveRaffleAction } from "@/lib/treasury/raffle-actions";

/**
 * Joins or leaves an open raffle. `disabled` (not open, or past its close) blocks both: the server refuses them from
 * closes_at on anyway. A double click sends one call; a refusal shows the mapped copy.
 */
export function JoinRaffleButton({
  id,
  entered,
  disabled,
  closesAt,
}: {
  id: string;
  entered: boolean;
  disabled: boolean;
  /** When given, the button turns itself off at that moment (the cron may take a while to close the raffle). */
  closesAt?: string;
}) {
  const router = useRouter();
  const [override, setOverride] = useState<boolean | null>(null);
  const [seen, setSeen] = useState(entered);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    const at = closesAt ? Date.parse(closesAt) : NaN;
    if (Number.isNaN(at)) return;
    const wait = Math.max(0, at - Date.now());
    if (wait > 2 ** 31 - 1) return; // longer than a timer can wait: the next refresh re-arms it
    const t = setTimeout(() => setExpired(true), wait);
    return () => clearTimeout(t);
  }, [closesAt]);

  // The server's answer (after a refresh) wins over the optimistic state.
  if (seen !== entered) {
    setSeen(entered);
    setOverride(null);
  }
  const inside = override ?? entered;

  async function toggle() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const res = inside ? await leaveRaffleAction(id) : await enterRaffleAction(id);
      if (res.ok) {
        setOverride(!inside);
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch {
      setError("No se pudo completar la acción. Inténtalo de nuevo.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {inside ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-success">
            <Check aria-hidden className="size-4" />
            Estás dentro
          </span>
        ) : null}
        <Button type="button" variant={inside ? "outline" : "default"} disabled={disabled || expired || pending} onClick={toggle}>
          {pending ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {inside ? "Salir del sorteo" : "Participar"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
