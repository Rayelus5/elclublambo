"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { usePastClose } from "@/components/giveaways/countdown";
import { Button } from "@/components/ui/button";
import { enterGiveawayAction, leaveGiveawayAction } from "@/lib/giveaways/actions";

/**
 * «Participar» / «Salir» of an open giveaway. Turns itself off at the close (the server refuses from closes_at on too).
 * A double click sends one call; the server's answer after the refresh wins over the optimistic state.
 */
export function JoinButton({ id, entered, closesAt }: { id: string; entered: boolean; closesAt: string }) {
  const router = useRouter();
  const [override, setOverride] = useState<boolean | null>(null);
  const [seen, setSeen] = useState(entered);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const past = usePastClose(closesAt);

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
      const res = inside ? await leaveGiveawayAction(id) : await enterGiveawayAction(id);
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
        <Button type="button" variant={inside ? "outline" : "default"} disabled={past || pending} onClick={toggle}>
          {pending ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
          {inside ? "Salir" : "Participar"}
        </Button>
        {inside ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-success">
            <Check aria-hidden className="size-4" />
            Estás dentro
          </span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
