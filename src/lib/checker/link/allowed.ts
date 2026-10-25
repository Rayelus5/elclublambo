import "server-only";
import { cacheLife } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { CRYPTO_BRANDS } from "./lists";

/** P4-R7: the allowed list is reused for ~5 minutes. `expire` under 5 minutes keeps it out of the build's prerender. */
export const ALLOWED_DOMAINS_CACHE = { stale: 60, revalidate: 240, expire: 299 } as const;

/** Throws (nothing is cached) when the read fails. Service role: request time only, after `await connection()`. */
async function cachedClubDomains(): Promise<string[]> {
  "use cache";
  cacheLife(ALLOWED_DOMAINS_CACHE);
  const { data, error } = await createAdminClient().from("allowed_domains").select("domain");
  if (error) throw new Error("allowed_domains read failed");
  return (data ?? []).map((r) => r.domain);
}

/** The club's allowed domains plus the crypto brands. If the read fails the brands still apply (no club list). */
export async function getKnownDomains(): Promise<string[]> {
  let club: string[] = [];
  try {
    club = await cachedClubDomains();
  } catch {
    // The link report just treats club domains as unknown (info), never as safe.
  }
  return [...new Set([...club, ...CRYPTO_BRANDS])];
}
