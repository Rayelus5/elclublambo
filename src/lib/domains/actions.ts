"use server";

import { revalidatePath } from "next/cache";
import { DOMAIN_RE } from "@/lib/domains/validate";
import { rpcErrorCode } from "@/lib/errors";
import { createServerClient } from "@/lib/supabase/server";

function clean(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const d = v.trim().toLowerCase();
  return DOMAIN_RE.test(d) ? d : null;
}

export async function addDomainAction(domain: string): Promise<{ error?: string }> {
  const d = clean(domain);
  if (!d) return { error: "invalid_input" };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("add_allowed_domain", { p_domain: d });
  if (error) return { error: rpcErrorCode(error) };
  revalidatePath("/settings/links");
  return {};
}

export async function removeDomainAction(domain: string): Promise<{ error?: string }> {
  const d = clean(domain);
  if (!d) return { error: "invalid_input" };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("remove_allowed_domain", { p_domain: d });
  if (error) return { error: rpcErrorCode(error) };
  revalidatePath("/settings/links");
  return {};
}
