// Poll reads. Goes through poll_details, which enforces visibility (a poll in a channel the viewer cannot see never
// comes back) and never returns anyone's vote but the caller's own while the poll is open.
import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePollRow, type PollDetail } from "@/lib/polls/polls";

/** Details per poll message id. Never throws: an error or a malformed row leaves the id out (the card falls back to the plain message). */
export async function getPollDetails(supabase: SupabaseClient, messageIds: readonly string[]): Promise<Map<string, PollDetail>> {
  const out = new Map<string, PollDetail>();
  if (messageIds.length === 0) return out;
  try {
    const { data, error } = await supabase.rpc("poll_details", { p_message_ids: [...messageIds] });
    if (error || !Array.isArray(data)) return out;
    for (const r of data) {
      const detail = parsePollRow(r);
      if (detail) out.set(detail.messageId, detail);
    }
  } catch {
    return new Map();
  }
  return out;
}
