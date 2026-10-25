"use client";

import { useState } from "react";
import { useAccount, useSignMessage, useSwitchChain } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { PenLine, Plug, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createBrowserClient } from "@/lib/supabase/browser";
import { safeNextPath } from "@/lib/auth/public-paths";
import { clubPath } from "@/lib/club/paths";
import { getDictionary } from "@/lib/i18n";
import { hardNavigate } from "@/lib/navigation/hard-navigate";
import type { Lang } from "@/lib/i18n/config";
import { buildLoginMessage, generateNonce } from "@/lib/web3/siwe";
import { NETWORKS, appChainIds, type ChainId } from "@/lib/economy/networks";

type Props = { lang: Lang; next: string | null };

function isUserRejection(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; code?: number; cause?: unknown };
  if (e.name === "UserRejectedRequestError" || e.code === 4001) return true;
  return e.cause ? isUserRejection(e.cause) : false;
}

/** Connect + sign in from the public side: same SIWE login as the club, in the visitor's language, no membership needed. */
export function PublicConnect({ lang, next }: Props) {
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
    let navigated = false;
    try {
      const message = buildLoginMessage({
        address,
        chainId: loginChain,
        nonce: generateNonce(),
        domain: window.location.host,
        uri: `${window.location.origin}${clubPath("/login")}`, // R1-R2: same SIWE uri as the club login
        lang,
      });
      let signature: `0x${string}`;
      try {
        signature = await signMessageAsync({ message });
      } catch (err) {
        setError(isUserRejection(err) ? c.errCancelled : c.errVerify);
        return;
      }
      const { error: authError } = await createBrowserClient().auth.signInWithWeb3({ chain: "ethereum", message, signature });
      if (authError) {
        setError(c.errVerify);
        return;
      }
      // P2-R16 hand-off through /foro/login/complete (completeLogin in public mode), a full navigation rather than a server
      // action. The public `next` falls back to the landing, not to the club home (R1-R4).
      navigated = true;
      hardNavigate(`${clubPath("/login/complete")}?mode=public&next=${encodeURIComponent(safeNextPath(next, "/"))}`);
    } catch {
      setError(c.errVerify);
    } finally {
      if (!navigated) setSigning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {!isConnected ? (
        <Button type="button" onClick={() => open()}>
          <Plug aria-hidden />
          {t.common.connect}
        </Button>
      ) : wrongChain ? (
        <Button
          type="button"
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
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
