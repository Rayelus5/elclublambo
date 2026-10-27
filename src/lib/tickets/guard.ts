// Real HTTP 404 for /foro/tickets/<missing | inaccessible | malformed>, decided in the proxy before the page streams
// (same reason and mechanism as src/lib/channels/guard.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { clubRelative } from "@/lib/club/paths";
import { NOT_FOUND_PATH } from "@/lib/channels/guard";
import { UUID_RE } from "@/lib/tickets/model";

export { NOT_FOUND_PATH };

const TICKET_PATH = /^\/tickets\/([^/]+)\/?$/;

/** The `[ticketId]` segment of `/foro/tickets/<id>` (no deeper paths), or null for any other pathname. */
export function ticketSegment(pathname: string): string | null {
  return TICKET_PATH.exec(clubRelative(pathname) ?? "")?.[1] ?? null;
}

type GuardClient = Pick<SupabaseClient, "from" | "rpc">;

/**
 * True when `pathname` is `/foro/tickets/<id>` and the member cannot read such a ticket. The tickets RLS (author, or
 * MANAGE_TICKETS in the ticket's channel) makes "not yours" and "does not exist" the same thing. Only active members
 * get a 404: everyone else is redirected by the forum layout. Any error fails open (the page itself still 404s).
 */
export async function isMissingTicket(supabase: GuardClient, pathname: string): Promise<boolean> {
  const segment = ticketSegment(pathname);
  if (segment === null) return false;

  if (UUID_RE.test(segment)) {
    const { data, error } = await supabase.from("tickets").select("id").eq("id", segment.toLowerCase()).maybeSingle();
    if (error) return false;
    if (data) return false;
  }

  const { data: status, error } = await supabase.rpc("my_membership_status");
  return !error && status === "active";
}
