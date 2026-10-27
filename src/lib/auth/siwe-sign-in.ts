// Cliente: el cuerpo SIWE del acceso con wallet (firma + sesión de Supabase en el navegador). No llama a ninguna acción de
// servidor, así que sirve también durante el mantenimiento, cuando el proxy responde 503 a las acciones y a los refetch RSC.
import { createBrowserClient } from "@/lib/supabase/browser";
import { clubPath } from "@/lib/club/paths";
import type { Lang } from "@/lib/i18n/config";
import { buildLoginMessage, generateNonce } from "@/lib/web3/siwe";

export type SignInResult = { ok: true } | { ok: false; error: "cancelled" | "verify" };

type Input = {
  address: `0x${string}`;
  chainId: number;
  lang: Lang;
  sign: (message: string) => Promise<`0x${string}`>;
};

function isUserRejection(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; code?: number; cause?: unknown };
  if (e.name === "UserRejectedRequestError" || e.code === 4001) return true;
  return e.cause ? isUserRejection(e.cause) : false;
}

/** Firma el mensaje de entrada (el mismo `uri` que el login del club, R1-R2) y abre la sesión de Supabase con él. */
export async function signInWithWallet({ address, chainId, lang, sign }: Input): Promise<SignInResult> {
  try {
    const message = buildLoginMessage({
      address,
      chainId,
      nonce: generateNonce(),
      domain: window.location.host,
      uri: `${window.location.origin}${clubPath("/login")}`,
      lang,
    });
    let signature: `0x${string}`;
    try {
      signature = await sign(message);
    } catch (err) {
      return { ok: false, error: isUserRejection(err) ? "cancelled" : "verify" };
    }
    const { error } = await createBrowserClient().auth.signInWithWeb3({ chain: "ethereum", message, signature });
    return error ? { ok: false, error: "verify" } : { ok: true };
  } catch {
    return { ok: false, error: "verify" };
  }
}
