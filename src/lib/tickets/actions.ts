"use server";

import { rpcErrorCode } from "@/lib/errors";
import { schedulePushDispatch } from "@/lib/push/schedule";
import { createServerClient } from "@/lib/supabase/server";
import { UUID_RE, validateBody, validateSubject } from "@/lib/tickets/model";

type Result = { id?: string; error?: string };

/** Opens a ticket in a channel with tickets. The database re-checks everything (access, limit, lengths). */
export async function openTicketAction(channelId: string, subject: string, body: string): Promise<Result> {
  const s = validateSubject(subject);
  const b = validateBody(body);
  if (typeof channelId !== "string" || !UUID_RE.test(channelId) || !s.ok || !b.ok) return { error: "invalid_input" };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("open_ticket", { p_channel: channelId, p_subject: s.value, p_body: b.value });
  if (error) return { error: rpcErrorCode(error) };
  // ticket_new notices were created for the staff: push them.
  schedulePushDispatch();
  return { id: typeof data === "string" ? data : undefined };
}

export async function postTicketMessageAction(ticketId: string, body: string): Promise<Result> {
  const b = validateBody(body);
  if (typeof ticketId !== "string" || !UUID_RE.test(ticketId) || !b.ok) return { error: "invalid_input" };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("post_ticket_message", { p_ticket: ticketId, p_body: b.value });
  if (error) return { error: rpcErrorCode(error) };
  schedulePushDispatch();
  return { id: typeof data === "string" ? data : undefined };
}

/** The author or the staff close; only the staff reopen (the database enforces it). */
export async function setTicketStatusAction(ticketId: string, status: "open" | "closed"): Promise<Result> {
  if (typeof ticketId !== "string" || !UUID_RE.test(ticketId) || (status !== "open" && status !== "closed")) {
    return { error: "invalid_input" };
  }
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_ticket_status", { p_ticket: ticketId, p_status: status });
  if (error) return { error: rpcErrorCode(error) };
  schedulePushDispatch();
  return {};
}
