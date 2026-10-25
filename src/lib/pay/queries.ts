import "server-only";
import { isNetworkKey } from "@/lib/economy/networks";
import { getPublicSession } from "@/lib/auth/public-session";
import { safeError } from "@/lib/security/redact";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import type { MyPublicProfile, PublicProfileView } from "./types";

type Raw = Record<string, unknown> | null;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const networks = (v: unknown) => (Array.isArray(v) ? v.filter(isNetworkKey) : []);

function toMine(raw: Raw): MyPublicProfile | null {
  if (!raw || typeof raw.alias !== "string" || typeof raw.address !== "string") return null;
  return {
    alias: raw.alias,
    displayName: str(raw.displayName),
    address: raw.address,
    acceptNetworks: networks(raw.acceptNetworks),
    showMemberBadge: raw.showMemberBadge === true,
  };
}

/**
 * The signed-in public account's own profile, or null (no session or no profile). Throws on a read error: an empty form
 * in its place would default to every network and could overwrite the saved ones on the next save (D22).
 */
export async function getMyPublicProfile(): Promise<MyPublicProfile | null> {
  if (!(await getPublicSession())) return null;
  const { data, error } = await (await createServerClient()).rpc("my_public_profile");
  if (error) {
    console.error("[pay] my profile read failed", safeError(error.message));
    throw new Error("my_public_profile read failed");
  }
  return toMine(data as Raw);
}

/**
 * What a visitor sees for an alias or an address (service role: nothing is granted to anon). Null when the alias does not
 * exist; an address without a profile comes back with every network and no alias. Throws on a read error.
 */
export async function getPublicProfileView(target: string): Promise<PublicProfileView | null> {
  const { data, error } = await createAdminClient().rpc("public_profile_view", { p_target: target });
  if (error) throw new Error(error.message);
  const raw = data as Raw;
  if (!raw || typeof raw.address !== "string") return null;
  return {
    alias: str(raw.alias),
    displayName: str(raw.displayName),
    address: raw.address,
    acceptNetworks: networks(raw.acceptNetworks),
    isMember: raw.isMember === true,
  };
}

/** {alias, displayName} of the profile that owns `address` (the receipt names its recipient), or null. */
export async function getProfileByAddress(address: string): Promise<{ alias: string; displayName: string | null } | null> {
  const { data, error } = await createAdminClient().rpc("public_profile_by_address", { p_address: address });
  if (error) throw new Error(error.message);
  const raw = data as Raw;
  if (!raw || typeof raw.alias !== "string") return null;
  return { alias: raw.alias, displayName: str(raw.displayName) };
}
