import "server-only";
import { giveawayRoleOptions, widenedRoleIds, type RoleOption } from "@/lib/giveaways/format";
import { getRolesContext } from "@/lib/roles/queries";
import { safeError } from "@/lib/security/redact";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The roles the «Crear sorteo» dialog offers (P1-R9), for a treasurer only (the caller checks). The role overwrites
 * are read with the service client: their RLS needs MANAGE_CHANNELS, which a treasurer may lack, and only role ids and
 * allow bits leave this function. Any failed read gives an empty list (the dialog then says there are none).
 */
export async function getGiveawayRoleOptions(): Promise<RoleOption[]> {
  try {
    const [ctx, overwrites] = await Promise.all([
      getRolesContext(),
      createAdminClient().from("permission_overwrites").select("target_id, allow").eq("target_type", "role"),
    ]);
    if (overwrites.error) throw new Error(overwrites.error.message);
    return giveawayRoleOptions(ctx, widenedRoleIds((overwrites.data ?? []) as { target_id: string; allow: number | string | null }[]));
  } catch (e) {
    console.error("[giveaways] role options read failed", safeError(e));
    return [];
  }
}
