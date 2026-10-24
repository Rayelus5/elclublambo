"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Loader2 } from "lucide-react";
import { shortAddress } from "@/lib/auth/wallet";
import { rpcErrorMessage } from "@/lib/errors";
import { setChainEnabledAction } from "@/lib/economy/actions";
import { NetworkLogo } from "@/components/economy/network-logo";
import { explorerAddress, NETWORKS, type ChainId } from "@/lib/economy/networks";
import { cn } from "@/lib/utils";

export type NetworkRow = { chainId: ChainId; enabled: boolean; safe: string | null };

/** One row per network of the build: the SuperAdmin enables or disables where money can move. */
export function NetworksForm({ chains }: { chains: NetworkRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<ChainId | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ChainId, string>>>({});
  const [, startTransition] = useTransition();

  function toggle(chainId: ChainId, enabled: boolean) {
    setBusy(chainId);
    setErrors((e) => ({ ...e, [chainId]: undefined }));
    startTransition(async () => {
      const res = await setChainEnabledAction(chainId, enabled);
      setBusy(null);
      if (!res.ok) {
        setErrors((e) => ({ ...e, [chainId]: rpcErrorMessage(res.error) }));
        return;
      }
      router.refresh();
    });
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-panel border border-border bg-surface px-4">
      {chains.map(({ chainId, enabled, safe }) => {
        const name = NETWORKS[chainId].name;
        const id = `network-${chainId}`;
        return (
          <li key={chainId} className="flex flex-col gap-2 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="inline-flex items-center gap-2">
                  <NetworkLogo chainId={chainId} size={20} />
                  <span id={`${id}-name`} className="text-sm font-bold text-fg">
                    {name}
                  </span>
                </span>
                {safe ? (
                  <a
                    href={explorerAddress(chainId, safe)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Safe de ${name}: ${shortAddress(safe)}`}
                    className="inline-flex min-h-11 items-center self-start rounded-control font-mono text-[13px] text-fg-muted underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                  >
                    {shortAddress(safe)}
                  </a>
                ) : (
                  <span className="text-[13px] text-fg-muted">Sin Safe configurada</span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-[13px] font-bold text-fg-muted">{enabled ? "Habilitada" : "Deshabilitada"}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`Habilitar ${name}`}
                  disabled={busy !== null}
                  onClick={() => toggle(chainId, !enabled)}
                  className="relative inline-flex min-h-11 w-14 shrink-0 items-center justify-center rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
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
                      {busy === chainId ? <Loader2 className="size-3 animate-spin text-bg motion-reduce:animate-none" /> : null}
                    </span>
                  </span>
                </button>
              </div>
            </div>
            {errors[chainId] ? (
              <p role="alert" className="flex items-start gap-2 text-sm break-words text-danger">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                {errors[chainId]}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
