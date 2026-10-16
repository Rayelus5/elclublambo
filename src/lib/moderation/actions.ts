"use server";

import { revalidatePath } from "next/cache";
import { rpcErrorCode } from "@/lib/errors";
import { createServerClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function banMemberAction(input: {
  memberId: string;
  reason: string;
  penalizeSponsor: boolean;
}): Promise<{ error?: string }> {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!UUID_RE.test(input.memberId) || reason.length < 3 || reason.length > 500) {
    return { error: "invalid_input" };
  }

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("ban_member", {
    p_target: input.memberId,
    p_reason: reason,
    p_penalize_sponsor: input.penalizeSponsor === true,
  });
  if (error) return { error: rpcErrorCode(error) };

  revalidatePath("/admin/members");
  return {};
}

export async function toggleSponsorRoleAction(input: {
  memberId: string;
  enabled: boolean;
}): Promise<{ error?: string }> {
  if (!UUID_RE.test(input.memberId)) return { error: "invalid_input" };

  const supabase = await createServerClient();
  const { data: role, error: roleError } = await supabase
    .from("roles")
    .select("id")
    .eq("name", "Padrino")
    .maybeSingle<{ id: string }>();
  if (roleError) return { error: rpcErrorCode(roleError) };
  if (!role) return { error: "unknown" };

  const { error } = await supabase.rpc("set_member_role", {
    p_member: input.memberId,
    p_role: role.id,
    p_enabled: input.enabled === true,
  });
  if (error) return { error: rpcErrorCode(error) };

  revalidatePath("/admin/members");
  return {};
}
