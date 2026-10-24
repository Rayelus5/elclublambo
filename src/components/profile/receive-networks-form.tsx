"use client";

import { useId, useState, useTransition } from "react";
import { NetworkLogo } from "@/components/economy/network-logo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { chainForKey, type NetworkKey } from "@/lib/economy/networks";
import { setReceiveNetworksAction } from "@/lib/profile/actions";

const KEYS: readonly NetworkKey[] = ["base", "arbitrum"];
const NAMES: Record<NetworkKey, string> = { base: "Base", arbitrum: "Arbitrum" };

/** Which networks tips can reach the member on. Never empty: the last checked box stays on. */
export function ReceiveNetworksForm({ initial }: { initial: NetworkKey[] }) {
  const uid = useId();
  const [selected, setSelected] = useState<NetworkKey[]>(initial);
  const [saved, setSaved] = useState(true);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const onlyOne = selected.length === 1;

  function toggle(key: NetworkKey, on: boolean) {
    setSelected((cur) => (on ? KEYS.filter((k) => k === key || cur.includes(k)) : cur.filter((k) => k !== key)));
    setSaved(false);
    setMessage(null);
  }

  function save() {
    setMessage(null);
    start(async () => {
      try {
        const r = await setReceiveNetworksAction(selected);
        if (r.ok) {
          setSaved(true);
          setMessage({ ok: true, text: "Guardado." });
        } else setMessage({ ok: false, text: r.error });
      } catch {
        setMessage({ ok: false, text: "No se pudo guardar el cambio. Inténtalo de nuevo." });
      }
    });
  }

  return (
    <section aria-labelledby={`${uid}-title`} className="flex flex-col gap-3">
      <h2 id={`${uid}-title`} className="text-h2">
        Redes en las que recibes
      </h2>
      <p id={`${uid}-hint`} className="text-sm text-fg-muted">
        Si tu dirección es de un exchange o una smart wallet, deja solo la red que admite.
      </p>
      <div className="flex flex-col gap-1">
        {KEYS.map((key) => {
          const checked = selected.includes(key);
          const locked = checked && onlyOne;
          const id = `${uid}-${key}`;
          return (
            <div key={key} className="flex items-center gap-3">
              <Checkbox
                id={id}
                checked={checked}
                disabled={locked || pending}
                aria-describedby={locked ? `${uid}-min` : `${uid}-hint`}
                onCheckedChange={(v) => toggle(key, v === true)}
              />
              <label htmlFor={id} className="inline-flex min-h-11 flex-1 items-center gap-2 text-sm font-bold text-fg">
                <NetworkLogo chainId={chainForKey(key)} decorative />
                {NAMES[key]}
              </label>
            </div>
          );
        })}
      </div>
      {onlyOne ? (
        <p id={`${uid}-min`} className="text-[13px] text-fg-muted">
          Tiene que quedar al menos una red.
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={pending || saved}>
          Guardar
        </Button>
        {message ? (
          <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-fg-muted" : "text-sm text-danger"}>
            {message.text}
          </p>
        ) : null}
      </div>
    </section>
  );
}
