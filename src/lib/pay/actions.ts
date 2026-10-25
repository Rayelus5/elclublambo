"use server";

import { revalidatePath } from "next/cache";
import { getPublicSession } from "@/lib/auth/public-session";
import { isNetworkKey, NETWORK_KEYS } from "@/lib/economy/networks";
import { safeError } from "@/lib/security/redact";
import { createServerClient } from "@/lib/supabase/server";
import { normalizeAlias } from "./alias";
import type { MyPublicProfile, SaveProfileError, SaveProfileInput, SaveProfileResult } from "./types";

const DISPLAY_NAME_MAX = 40;
const SQL_CODES: ReadonlySet<string> = new Set([
  "alias_invalid",
  "alias_reserved",
  "alias_taken",
  "networks_invalid",
  "display_name_invalid",
  "rate_limited",
  "forbidden",
]);

const fail = (error: SaveProfileError): SaveProfileResult => ({ ok: false, error });

/**
 * Creates or updates the signed-in public account's profile. Re-validated here and again in SQL (30 changes an hour).
 * The old alias stops working at once, so the pages of both are revalidated.
 */
export async function savePublicProfileAction(input: SaveProfileInput): Promise<SaveProfileResult> {
  const { alias: rawAlias, displayName, acceptNetworks, showMemberBadge } = input ?? ({} as SaveProfileInput);
  if (typeof rawAlias !== "string") return fail("alias_invalid");
  const alias = normalizeAlias(rawAlias);
  if (!alias.ok) return fail(alias.error);
  if (displayName !== undefined && typeof displayName !== "string") return fail("display_name_invalid");
  const name = (displayName ?? "").trim();
  if (name.length > DISPLAY_NAME_MAX) return fail("display_name_invalid");
  if (!Array.isArray(acceptNetworks) || acceptNetworks.length === 0 || !acceptNetworks.every(isNetworkKey)) return fail("networks_invalid");
  const networks = NETWORK_KEYS.filter((k) => acceptNetworks.includes(k));
  if (typeof showMemberBadge !== "boolean") return fail("forbidden");

  if (!(await getPublicSession())) return fail("not_authenticated");
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("upsert_public_profile", {
    p_alias: alias.alias,
    p_display_name: name || null,
    p_accept_networks: networks,
    p_show_member_badge: showMemberBadge,
  });
  if (error) {
    // Supabase hands `raise exception '<code>'` back as error.message.
    const code = error.message;
    if (SQL_CODES.has(code)) return fail(code as SaveProfileError);
    console.error("[pay] profile save failed", safeError(error.message));
    return fail("unknown");
  }
  const p = data as Partial<MyPublicProfile> | null;
  if (!p || typeof p.alias !== "string") return fail("unknown");
  for (const lang of ["es", "en"]) {
    revalidatePath(`/${lang}/pay/${p.alias}`);
    revalidatePath(`/${lang}/tools/pay`);
  }
  return {
    ok: true,
    profile: {
      alias: p.alias,
      displayName: typeof p.displayName === "string" ? p.displayName : null,
      address: String(p.address),
      acceptNetworks: (Array.isArray(p.acceptNetworks) ? p.acceptNetworks : []).filter(isNetworkKey),
      showMemberBadge: p.showMemberBadge === true,
    },
  };
}
