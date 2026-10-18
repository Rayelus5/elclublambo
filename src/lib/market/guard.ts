// Real HTTP 404 for /mercado/<invalid id> (`../`, uppercase, 200 chars…), decided in the proxy before the forum layout's
// Suspense starts streaming (a notFound() in the page would already be a 200). Same mechanism as src/lib/channels/guard.ts.
// An unknown but well-formed id is still the page's own notFound() (ruling F4b-R3): telling it apart needs CoinGecko.
import type { SupabaseClient } from "@supabase/supabase-js";
import { COIN_ID_RE } from "@/lib/market/types";

const COIN_PATH = /^\/mercado\/([^/]+)\/?$/;

/** The raw (still percent-encoded) `[id]` segment of `/mercado/<id>` (no deeper paths), or null for any other pathname. */
export function coinSegment(pathname: string): string | null {
  return COIN_PATH.exec(pathname)?.[1] ?? null;
}

type GuardClient = Pick<SupabaseClient, "rpc">;

/**
 * True when `pathname` is `/mercado/<id>` with an id the page would reject. Only active members get the 404: everyone
 * else is redirected by the forum layout. A failed status check fails open (the page itself still renders not-found).
 */
export async function isInvalidCoinPage(supabase: GuardClient, pathname: string): Promise<boolean> {
  const segment = coinSegment(pathname);
  if (segment === null) return false;
  let id: string;
  try {
    id = decodeURIComponent(segment);
  } catch {
    id = ""; // malformed escape: invalid
  }
  if (COIN_ID_RE.test(id)) return false;
  const { data: status, error } = await supabase.rpc("my_membership_status");
  return !error && status === "active";
}
