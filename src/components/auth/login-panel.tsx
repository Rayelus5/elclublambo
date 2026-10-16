"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useSignMessage, useSwitchChain } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { PenLine, Plug, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createBrowserClient } from "@/lib/supabase/browser";
import { completeLogin } from "@/lib/auth/actions";
import { safeNextPath } from "@/lib/auth/public-paths";
import { rpcErrorMessage } from "@/lib/errors";
import { buildLoginMessage, generateNonce } from "@/lib/web3/siwe";
import { getAppChain } from "@/lib/web3/chains";

type Props = { inviteCode?: string | null; next?: string | null };

const MSG_VERIFY = "No se pudo verificar la firma. Inténtalo de nuevo.";
const MSG_CANCELLED = "Firma cancelada.";

function isUserRejection(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; code?: number; cause?: unknown };
  if (e.name === "UserRejectedRequestError" || e.code === 4001) return true;
  return e.cause ? isUserRejection(e.cause) : false;
}

function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function LoginPanel({ inviteCode = null, next = null }: Props) {
  const router = useRouter();
  const { open } = useAppKit();
  const { address, chainId, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { switchChain } = useSwitchChain();
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = getAppChain();
  const wrongChain = isConnected && chainId !== target.id;

  async function signIn() {
    if (!address || signing) return;
    setError(null);
    setSigning(true);
    try {
      const message = buildLoginMessage({
        address,
        chainId: target.id,
        nonce: generateNonce(),
        domain: window.location.host,
        uri: `${window.location.origin}/login`,
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
      // Con error y sin salir de la página (/login), se muestra aquí; en el resto la
      // redirección (p. ej. /invite/<code>?error=…) ya presenta el error.
      if (loginError && redirectTo === "/login") {
        setError(rpcErrorMessage(loginError));
        return;
      }
      router.replace(redirectTo === "/" ? safeNextPath(next) : redirectTo);
    } catch {
      setError(MSG_VERIFY);
    } finally {
      setSigning(false);
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
        <Button type="button" size="lg" onClick={() => open()}>
          <Plug aria-hidden />
          Conectar wallet
        </Button>
      ) : wrongChain ? (
        <Button type="button" size="lg" onClick={() => switchChain({ chainId: target.id })}>
          <Repeat aria-hidden />
          Cambiar a Linea
        </Button>
      ) : (
        <Button type="button" size="lg" disabled={signing} onClick={signIn}>
          <PenLine aria-hidden />
          {signing ? "Firmando…" : "Firmar y entrar"}
        </Button>
      )}

      {error ? (
        <p role="alert" className="border border-danger px-4 py-3 text-[13px] text-danger rounded-control">
          {error}
        </p>
      ) : null}
    </div>
  );
}
