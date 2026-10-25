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
  return { userId: user.id, wallet, isMember: status === "active" };
});
