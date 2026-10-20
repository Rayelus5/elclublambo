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
  return (await welcomeStatus(supabase, userId, pathname, method)) === "pending";
}

/**
 * The same check with its reason: "pending" (send to the welcome; also on a read error), "completed" (read and done: it
 * is set once and never undone, so the proxy may remember it, see WELCOMED_COOKIE) or "skip" (not gated: another
 * method, an exempt path, or not a member).
 */
export async function welcomeStatus(
  supabase: GuardClient,
  userId: string,
  pathname: string,
  method: string,
): Promise<"pending" | "completed" | "skip"> {
  if ((method !== "GET" && method !== "HEAD") || isOnboardingExempt(pathname)) return "skip";
  const { data, error } = await supabase
    .from("members")
    .select("welcome_completed_at")
    .eq("auth_user_id", userId)
    .maybeSingle<{ welcome_completed_at: string | null }>();
  if (error) return "pending";
  if (!data) return "skip";
  return data.welcome_completed_at === null ? "pending" : "completed";
}

/**
 * T-006: remembers, per user, that the welcome is done (value: the auth user id), so the proxy skips the members read
 * on later requests (every page request and every router prefetch). Only a UX gate: the forum layout re-reads the row.
 */
export const WELCOMED_COOKIE = "ecl_welcomed";
