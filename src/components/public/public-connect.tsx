"use client";

import { useState, type ComponentProps } from "react";
import { useAccount, useSignMessage, useSwitchChain } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { PenLine, Plug, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { publicRegistrationGate } from "@/lib/admin/registration-actions";
import { safeNextPath } from "@/lib/auth/public-paths";
import { signInWithWallet } from "@/lib/auth/siwe-sign-in";
import { clubPath } from "@/lib/club/paths";
import { getDictionary } from "@/lib/i18n";
import { hardNavigate } from "@/lib/navigation/hard-navigate";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { Lang } from "@/lib/i18n/config";
import { NETWORKS, appChainIds, type ChainId } from "@/lib/economy/networks";

type Props = { lang: Lang; next: string | null; variant?: ComponentProps<typeof Button>["variant"] };

/** Connect + sign in from the public side: same SIWE login as the club, in the visitor's language, no membership needed. */
export function PublicConnect({ lang, next, variant }: Props) {
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
      const result = await signInWithWallet({ address, chainId: loginChain, lang, sign: (message) => signMessageAsync({ message }) });
      if (!result.ok) {
        setError(result.error === "cancelled" ? c.errCancelled : c.errVerify);
        return;
      }
      // A-R13: a new account made while registration is closed is deleted on the server; drop the local session too and
      // say so here, before navigating. If the action itself fails, /login/complete enforces the same rule.
      const gate = await publicRegistrationGate().catch(() => ({ ok: true }) as const);
      if (!gate.ok) {
        await createBrowserClient()
          .auth.signOut({ scope: "local" })
          .catch(() => {});
        setError(c.errRegistrationClosed);
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
        <Button type="button" variant={variant} onClick={() => open()}>
          <Plug aria-hidden />
          {t.common.connect}
        </Button>
      ) : wrongChain ? (
        <Button
          type="button"
          variant={variant}
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
        <Button type="button" variant={variant} disabled={signing} onClick={signIn}>
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
