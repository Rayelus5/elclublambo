// Real HTTP 404 for /foro/dao/tesoreria when the member does not hold MANAGE_TREASURY, decided in the proxy before the page
// streams (same reason and mechanism as src/lib/reports/guard.ts: under <Suspense> a notFound() arrives as a 200).
// The page and every RPC behind it re-check the permission.
import type { SupabaseClient } from "@supabase/supabase-js";
import { clubRelative } from "@/lib/club/paths";
import { hasPerm, Perm } from "@/lib/permissions/bits";

const TREASURY_PATH = /^\/dao\/tesoreria(?:\/.*)?$/;

type GuardClient = Pick<SupabaseClient, "from" | "rpc">;

/**
 * True when `pathname` is the treasurer panel and the member lacks MANAGE_TREASURY (ADMINISTRATOR counts). Hidden and
 * missing look the same. Only active members get a 404 (everyone else is redirected by the forum layout), and any
 * error fails open (the page itself still calls notFound()).
 */
export async function isHiddenTreasuryPage(supabase: GuardClient, pathname: string): Promise<boolean> {
  if (!TREASURY_PATH.test(clubRelative(pathname) ?? "")) return false;

  const { data: raw, error } = await supabase.rpc("my_permissions");
  if (error || raw === null || raw === undefined) return false;
  let perms: bigint;
  try {
    perms = BigInt(String(raw));
  } catch {
    return false;
  }
  if (hasPerm(perms, Perm.MANAGE_TREASURY)) return false;

  const { data: status, error: statusError } = await supabase.rpc("my_membership_status");
  return !statusError && status === "active";
}
