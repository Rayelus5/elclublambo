"use server";

// A-R13: `PublicConnect` pregunta aquí tras firmar y antes de navegar, para poder mostrar «registro cerrado».
import { enforceNewPublicAccount } from "@/lib/admin/registration";
import { createServerClient } from "@/lib/supabase/server";

export type RegistrationGate = { ok: true } | { ok: false; error: "registration_closed" };

export async function publicRegistrationGate(): Promise<RegistrationGate> {
  const supabase = await createServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return { ok: true };
  const { data: status, error } = await supabase.rpc("my_membership_status");
  if (error) return { ok: true };
  return (await enforceNewPublicAccount(supabase, user, status)) === "closed"
    ? { ok: false, error: "registration_closed" }
    : { ok: true };
}
