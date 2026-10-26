"use server";

// A-R13: `PublicConnect` pregunta aquí tras firmar y antes de navegar, para poder mostrar «registro cerrado».
import { isSuperAdminWallet, walletFromUser } from "@/lib/auth/wallet";
import { enforcePublicRegistration } from "@/lib/admin/registration";
import { createServerClient } from "@/lib/supabase/server";

export type RegistrationGate = { ok: true } | { ok: false; error: "registration_closed" };

export async function publicRegistrationGate(): Promise<RegistrationGate> {
  const supabase = await createServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return { ok: true };
  // El arranque del SuperAdmin tiene que seguir funcionando con el registro cerrado.
  const wallet = walletFromUser(user);
  if (wallet && isSuperAdminWallet(wallet, process.env.SUPER_ADMIN_WALLET)) return { ok: true };
  const { data: status, error } = await supabase.rpc("my_membership_status");
  if (error || status !== "none") return { ok: true };
  return (await enforcePublicRegistration(supabase, user.id)) === "closed"
    ? { ok: false, error: "registration_closed" }
    : { ok: true };
}
