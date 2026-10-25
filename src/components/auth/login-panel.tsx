"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useDisconnect, useSignMessage, useSwitchChain } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { PenLine, Plug, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createBrowserClient } from "@/lib/supabase/browser";
import { completeLogin } from "@/lib/auth/actions";
import { safeNextPath } from "@/lib/auth/public-paths";
import { clubPath } from "@/lib/club/paths";
import { shortAddress } from "@/lib/auth/wallet";
import { buildLoginMessage, generateNonce } from "@/lib/web3/siwe";
import { NETWORKS, appChainIds, type ChainId } from "@/lib/economy/networks";

type Props = { inviteCode?: string | null; next?: string | null };

const MSG_VERIFY = "No se pudo verificar la firma. Inténtalo de nuevo.";
const MSG_CANCELLED = "Firma cancelada.";
const MSG_SWITCH = "No se pudo cambiar de red.";

function isUserRejection(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; code?: number; cause?: unknown };
  if (e.name === "UserRejectedRequestError" || e.code === 4001) return true;
  return e.cause ? isUserRejection(e.cause) : false;
}

export function LoginPanel({ inviteCode = null, next = null }: Props) {
  const router = useRouter();
  const { open } = useAppKit();
  const { address, chainId, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { disconnect } = useDisconnect();
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The wallet signs on whichever of the build's chains it is on; any other chain is switched to the first (Base).
  const chains = appChainIds();
  const loginChain = chains.find((c) => c === chainId);
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
        uri: `${window.location.origin}${clubPath("/login")}`,
      });

      let signature: `0x${string}`;
      try {
        signature = await signMessageAsync({ message });
      } catch (err) {
        setError(isUserRejection(err) ? MSG_CANCELLED : MSG_VERIFY);
        return;
      }

      const { error: authError } = await createBrowserClient().auth.signInWithWeb3({
        chain: "ethereum",
        message,
        signature,
      });
      if (authError) {
        setError(MSG_VERIFY);
        return;
      }

      const { redirectTo, error: loginError } = await completeLogin(inviteCode);
      // Éxito: se mantiene `signing` activo mientras navega para evitar un doble envío.
      // /foro/invite/<code>?error=… ya presenta su error; /foro/no-access lo recibe por ?error=.
      navigated = true;
      if (loginError && redirectTo === clubPath("/no-access")) {
        router.replace(`${clubPath("/no-access")}?error=${encodeURIComponent(loginError)}`);
      } else {
        router.replace(redirectTo === clubPath() ? safeNextPath(next) : redirectTo);
      }
    } catch {
      setError(MSG_VERIFY);
    } finally {
      if (!navigated) setSigning(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {isConnected && address ? (
        <p className="flex items-center justify-between gap-3 border border-border bg-bg px-4 py-3 text-[13px] text-fg-muted rounded-control">
          <span>Wallet conectada</span>
          <span className="font-mono text-fg">{shortAddress(address)}</span>
        </p>
      ) : null}

      {!isConnected ? (
        <>
          <Button
            type="button"
            size="lg"
            aria-describedby="wallet-network-hint"
            onClick={() => open()}
          >
            <Plug aria-hidden />
            Conectar wallet
          </Button>
          {/* AppKit pide conexión y cambio de red seguidos si la wallet está en
              otra red, y la ventana de MetaMask falla ("reading 'origin'"). */}
          <p id="wallet-network-hint" className="text-[13px] text-fg-muted">
            Usa tu wallet en Base o Arbitrum.
          </p>
        </>
      ) : wrongChain ? (
        <Button
          type="button"
          size="lg"
          disabled={switching}
          onClick={() => {
            setError(null);
            switchChain({ chainId: target.id }, { onError: () => setError(MSG_SWITCH) });
          }}
        >
          <Repeat aria-hidden />
          {switching ? "Cambiando…" : `Cambiar a ${target.name}`}
        </Button>
      ) : (
        <Button type="button" size="lg" disabled={signing} onClick={signIn}>
          <PenLine aria-hidden />
          {signing ? "Firmando…" : "Firmar y entrar"}
        </Button>
      )}

      {isConnected ? (
        <Button type="button" variant="ghost" size="sm" disabled={signing} onClick={() => disconnect()}>
          Cambiar de wallet
        </Button>
      ) : null}

      {error ? (
        <p role="alert" className="border border-danger px-4 py-3 text-[13px] text-danger rounded-control">
          {error}
        </p>
      ) : null}
    </div>
  );
}
