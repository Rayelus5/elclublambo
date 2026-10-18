import type { SupabaseClient } from "@supabase/supabase-js";
import { isPublicPath } from "@/lib/auth/public-paths";

type GuardClient = Pick<SupabaseClient, "from">;

/** The welcome itself and the guide (static help the welcome links to) are reachable before the welcome is done. */
export function isOnboardingExempt(pathname: string): boolean {
  if (isPublicPath(pathname)) return true;
  return ["/bienvenida", "/guia"].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * True when an authenticated member must be sent to /bienvenida: they are a member (they have a row) and
 * `welcome_completed_at` is null. Layouts do not re-run on client navigations, so the proxy enforces this on every
 * page request. Non-members (no readable row) keep the current behaviour (their pages send them to /no-access).
 * A read error fails closed (to the welcome, whose own layout re-checks the membership).
 * It is a UX gate, not access control: only page requests (GET/HEAD) are gated.
 */
export async function needsWelcome(
  supabase: GuardClient,
  userId: string,
  pathname: string,
  method: string,
): Promise<boolean> {
  if ((method !== "GET" && method !== "HEAD") || isOnboardingExempt(pathname)) return false;
  const { data, error } = await supabase
    .from("members")
    .select("welcome_completed_at")
    .eq("auth_user_id", userId)
    .maybeSingle<{ welcome_completed_at: string | null }>();
  if (error) return true;
  if (!data) return false;
  return data.welcome_completed_at === null;
}
