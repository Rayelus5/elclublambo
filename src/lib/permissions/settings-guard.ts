// Real HTTP 404 for /settings pages the member cannot open, decided in the proxy before the page streams (same reason
// and mechanism as src/lib/reports/guard.ts: under <Suspense> a notFound() arrives as a 200).
import type { SupabaseClient } from "@supabase/supabase-js";
import { settingsSections } from "@/lib/permissions/settings";

const SETTINGS_PATH = /^\/settings(?:\/([^/]+))?\/?$/;

type GuardClient = Pick<SupabaseClient, "from" | "rpc">;

/**
 * True when `pathname` is /settings and the member has no settings section, or a known section they lack.
 * Unknown subpaths are left to the router. Only active members get a 404 (everyone else is redirected by the forum
 * layout), and any error fails open (the layout and pages still call notFound()).
 */
export async function isHiddenSettingsPage(supabase: GuardClient, pathname: string): Promise<boolean> {
  const match = SETTINGS_PATH.exec(pathname);
  if (!match) return false;

  const { data: rawPerms, error } = await supabase.rpc("my_permissions");
  if (error || rawPerms === null || rawPerms === undefined) return false;
  let perms: bigint;
  try {
    perms = BigInt(String(rawPerms));
  } catch {
    return false;
  }

  const visible = settingsSections(perms).map((s) => s.href);
  // -1n has every bit set (ADMINISTRATOR included, which hasPerm short-circuits): every known section.
  const all = settingsSections(-1n).map((s) => s.href);
  const section = match[1] ? `/settings/${match[1]}` : null;
  const hidden = visible.length === 0 || (section !== null && all.includes(section) && !visible.includes(section));
  if (!hidden) return false;

  const { data: status, error: statusError } = await supabase.rpc("my_membership_status");
  return !statusError && status === "active";
}
