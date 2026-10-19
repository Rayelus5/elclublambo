import "server-only";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import { createServerClient } from "@/lib/supabase/server";

/**
 * The caller's member id when they hold MANAGE_TREASURY (or ADMINISTRATOR), else null. Uses the caller's JWT only. The
 * gate of every treasury server action (withdrawals and raffles); SQL re-checks the bit.
 */
export async function treasurerId(): Promise<string | null> {
  const supabase = await createServerClient();
  const [perms, me] = await Promise.all([supabase.rpc("my_permissions"), supabase.rpc("current_member_id")]);
  const raw = String(perms.data ?? "0");
  const bits = /^\d+$/.test(raw) ? BigInt(raw) : 0n;
  if (!hasPerm(bits, Perm.MANAGE_TREASURY)) return null;
  return typeof me.data === "string" ? me.data : null;
}
