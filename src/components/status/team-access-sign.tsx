"use client";

import { useState } from "react";
import { useAccount, useSignMessage, useSwitchChain } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { PenLine, Plug, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signInWithWallet } from "@/lib/auth/siwe-sign-in";
import { getDictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { NETWORKS, appChainIds, type ChainId } from "@/lib/economy/networks";

/**
 * The wallet step of «Acceso del equipo»: connect (AppKit), switch to an app chain if needed, then «Firmar y entrar» (the
 * panel's one brand fill). Signs in straight against Supabase from the browser; no server action, no navigation.
 */
export function TeamAccessSign({ lang, onSignedIn }: { lang: Lang; onSignedIn: () => void }) {
  const t = getDictionary(lang);
  const c = t.connect;
  const { open } = useAppKit();
  const { address, chainId, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chains = appChainIds();
  const loginChain = chains.find((id) => id === chainId);
  const target = NETWORKS[chains[0] as ChainId];
  const wrongChain = isConnected && loginChain === undefined;

  async function signIn() {
    if (!address || loginChain === undefined || signing) return;
    setError(null);
    setSigning(true);
    const result = await signInWithWallet({ address, chainId: loginChain, lang, sign: (message) => signMessageAsync({ message }) });
    setSigning(false);
    if (result.ok) onSignedIn();
    else setError(result.error === "cancelled" ? c.errCancelled : c.errVerify);
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {!isConnected ? (
        <Button type="button" variant="outline" onClick={() => open()}>
          <Plug aria-hidden />
          {t.common.connect}
        </Button>
      ) : wrongChain ? (
        <Button
          type="button"
          variant="outline"
          disabled={switching}
          onClick={() => {
            setError(null);
            switchChain({ chainId: target.id }, { onError: () => setError(c.errSwitch) });
          }}
        >
          <Repeat aria-hidden />
          {switching ? c.switching : `${c.switchTo} ${target.name}`}
        </Button>
      ) : (
        <Button type="button" disabled={signing} onClick={signIn}>
          <PenLine aria-hidden />
          {signing ? c.signing : c.signIn}
        </Button>
      )}
      <p className="text-[13px] text-fg-muted">{c.hint}</p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
