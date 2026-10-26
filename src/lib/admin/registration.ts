import "server-only";
// A-R13 Registro cerrado: borra la cuenta nueva que el trigger dejó retenida y cierra su sesión. Las cuentas que ya
// existían, las invitaciones del club y el arranque del SuperAdmin no pasan por aquí (o la RPC dice `false`).
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSuperAdminWallet, walletFromUser } from "@/lib/auth/wallet";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeError } from "@/lib/security/redact";

export type RegistrationOutcome = "ok" | "closed";

export async function enforcePublicRegistration(
  supabase: Pick<SupabaseClient, "rpc" | "auth">,
  userId: string,
): Promise<RegistrationOutcome> {
  const { data, error } = await supabase.rpc("my_registration_blocked");
  if (error) {
    // Fail-open: `is_public_account()` ya niega la cuenta retenida en la BD; aquí solo se registra el código.
    console.error("[registration] blocked check failed", safeError(error));
    return "ok";
  }
  if (data !== true) return "ok";
  const { error: delError } = await createAdminClient().auth.admin.deleteUser(userId);
  // Si el borrado falla, la retención sigue cerrando la cuenta en la BD: se cierra la sesión igualmente.
  if (delError) console.error("[registration] delete failed", safeError(delError));
  await supabase.auth.signOut();
  return "closed";
}

/**
 * The one rule both sign-in paths share (`completeLogin(…, "public")` and `publicRegistrationGate()`): only a brand-new
 * account (membership status exactly `none`) is checked, and never the SuperAdmin wallet, whose bootstrap must keep
 * working with registration closed.
 */
export async function enforceNewPublicAccount(
  supabase: Pick<SupabaseClient, "rpc" | "auth">,
  user: { id: string } & NonNullable<Parameters<typeof walletFromUser>[0]>,
  status: unknown,
  env: Record<string, string | undefined> = process.env,
): Promise<RegistrationOutcome> {
  if (status !== "none") return "ok";
  const wallet = walletFromUser(user);
  if (wallet !== null && isSuperAdminWallet(wallet, env.SUPER_ADMIN_WALLET)) return "ok";
  return enforcePublicRegistration(supabase, user.id);
}
