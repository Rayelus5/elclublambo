// Real HTTP 404 for /foro/moderation/reports when the member moderates no channel, decided in the proxy before the page
// streams (same reason and mechanism as src/lib/channels/guard.ts: under <Suspense> a notFound() arrives as a 200).
import type { SupabaseClient } from "@supabase/supabase-js";
import { clubRelative } from "@/lib/club/paths";
import { Perm } from "@/lib/permissions/bits";

const REPORTS_PATH = /^\/moderation\/reports\/?$/;

type GuardClient = Pick<SupabaseClient, "from" | "rpc">;

/**
 * True when `pathname` is the report queue and the member holds MANAGE_MESSAGES in no channel they can see.
 * Hidden and missing look the same. Only active members get a 404 (everyone else is redirected by the forum layout),
 * and any error fails open (the page itself still calls notFound()).
 */
export async function isHiddenReportsPage(supabase: GuardClient, pathname: string): Promise<boolean> {
  if (!REPORTS_PATH.test(clubRelative(pathname) ?? "")) return false;

  const { data: anywhere, error } = await supabase.rpc("has_any_channel_perm", { p_bit: Number(Perm.MANAGE_MESSAGES) });
  if (error || anywhere !== false) return false;

  const { data: status, error: statusError } = await supabase.rpc("my_membership_status");
  return !statusError && status === "active";
}
