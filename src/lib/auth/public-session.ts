import "server-only";
import { cache } from "react";
import { createServerClient } from "@/lib/supabase/server";
import { walletFromUser } from "./wallet";

export type PublicSession = { userId: string; wallet: `0x${string}`; isMember: boolean };

/**
 * The signed-in wallet on the public side (same SIWE session as the club). Banned members have no public account.
 * Cached per request (React cache): the header, the page and its metadata ask for it in the same render.
 */
export const getPublicSession = cache(async function getPublicSession(): Promise<PublicSession | null> {
  const supabase = await createServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return null;
  const wallet = walletFromUser(user);
  if (!wallet) return null;
  const { data: status, error } = await supabase.rpc("my_membership_status");
  if (error || status === "banned") return null;
  // A-R13: an account made while registration is closed (held, no members row) has no public account either. This is the
  // one gate in front of every public action, including the service-role RPCs where `is_public_account()` never runs.
  // Only status `none` can be held; a failed check fails closed, like the status read.
  if (status === "none") {
    const { data: blocked, error: blockErr } = await supabase.rpc("my_registration_blocked");
    if (blockErr || blocked !== false) return null;
  }
  return { userId: user.id, wallet, isMember: status === "active" };
});
