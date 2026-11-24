import "server-only";
import { cache } from "react";
import { createServerClient } from "@/lib/supabase/server";
import { resolvePublicSession, type PublicSession } from "./public-session-core";

export type { PublicSession } from "./public-session-core";

/**
 * The signed-in wallet on the public side (same SIWE session as the club), validated with the auth server (getUser).
 * This is the one gate in front of every public action, including the service-role RPCs where `is_public_account()`
 * never runs (rules in resolvePublicSession). Cached per request (React cache): the page and its metadata ask for it in
 * the same render. The public header resolves the same session in the browser (usePublicSession).
 */
export const getPublicSession = cache(async function getPublicSession(): Promise<PublicSession | null> {
  const supabase = await createServerClient();
  const { data } = await supabase.auth.getUser();
  return resolvePublicSession(data?.user ?? null, supabase);
});
