import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeError } from "@/lib/security/redact";

// Solo la página del sorteo (no sus imágenes OG ni la ruta `entries`), en el árbol interno.
const GIVEAWAY_PAGE = /^\/(?:es|en)\/tools\/giveaways\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The giveaway id of an internal giveaway page path (`/{lang}/tools/giveaways/<uuid>`), or null. */
export function giveawayPageId(internalPath: string): string | null {
  return GIVEAWAY_PAGE.exec(internalPath)?.[1] ?? null;
}

/**
 * Whether `internalPath` is the page of a public giveaway that does not exist. The page streams under <Suspense>, so its
 * notFound() would answer 200: the proxy decides the 404 with this read. Service role (nothing is granted to anon); a
 * read error answers false and lets the page report it.
 */
export async function isMissingPublicGiveaway(internalPath: string): Promise<boolean> {
  const id = giveawayPageId(internalPath);
  if (!id) return false;
  const { data, error } = await createAdminClient().from("public_giveaways").select("id").eq("id", id).maybeSingle();
  if (error) {
    console.error("[public-giveaways] existence check failed", safeError(error.message));
    return false;
  }
  return data === null;
}
