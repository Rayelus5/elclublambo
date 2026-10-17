"use client";

import { useEffect, useState } from "react";
import { BellRing, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { currentPushSubscription, disablePush, enablePush, pushSupported, resyncPushSubscription } from "@/lib/push/client";

type State = "hidden" | "off" | "on" | "denied" | "busy";

/**
 * Web Push opt-in for this device. Only rendered with a VAPID public key and browser support; the permission prompt
 * appears only after pressing the button.
 */
export function PushToggle({ publicKey }: { publicKey: string | undefined }) {
  const [state, setState] = useState<State>("hidden");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey || !pushSupported()) return;
    let cancelled = false;
    void (async () => {
      let next: State = "off";
      if (Notification.permission === "denied") next = "denied";
      else if (Notification.permission === "granted") {
        const existing = await currentPushSubscription().catch(() => null);
        if (existing) {
          next = "on";
          // Make sure the server row exists for this device (best effort: the toggle still reflects the browser).
          void resyncPushSubscription(existing);
        }
      }
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  if (!publicKey || state === "hidden") return null;

  if (state === "denied") {
    return (
      <p className="max-w-prose text-sm text-fg-muted">
        Has bloqueado los avisos de este sitio en el navegador. Para activarlos, permite las notificaciones desde los
        ajustes del sitio (el icono junto a la dirección) y recarga la página.
      </p>
    );
  }

  const toggle = async () => {
    const wasOn = state === "on";
    setError(null);
    setState("busy");
    if (wasOn) {
      const ok = await disablePush();
      if (!ok) setError("No se pudieron desactivar los avisos. Inténtalo de nuevo.");
      setState(ok ? "off" : "on");
      return;
    }
    const result = await enablePush(publicKey);
    if (result === "enabled") setState("on");
    else if (result === "denied") setState(Notification.permission === "denied" ? "denied" : "off");
    else {
      setError("No se pudieron activar los avisos. Inténtalo de nuevo.");
      setState("off");
    }
  };

  const on = state === "on";
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant={on ? "secondary" : "default"}
        disabled={state === "busy"}
        onClick={() => void toggle()}
        aria-label={on ? "Desactivar avisos en este dispositivo" : "Activar avisos en este dispositivo"}
      >
        {on ? <BellOff aria-hidden /> : <BellRing aria-hidden />}
        {on ? "Desactivar avisos en este dispositivo" : "Activar avisos en este dispositivo"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
