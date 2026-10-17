"use server";

import { rpcErrorCode } from "@/lib/errors";
import { schedulePushDispatch } from "@/lib/push/schedule";
import { isReportReason, REPORT_NOTE_MAX } from "@/lib/reports/reasons";
import { createServerClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result = { error?: string };

/** Reports a message. The database re-checks everything (visibility, own message, duplicates, rate limit). */
export async function reportMessageAction(messageId: string, reason: string, note: string | null): Promise<Result> {
  const trimmed = typeof note === "string" ? note.trim() : "";
  if (
    typeof messageId !== "string" ||
    !UUID_RE.test(messageId) ||
    !isReportReason(reason) ||
    (note !== null && typeof note !== "string") ||
    trimmed.length > REPORT_NOTE_MAX
  ) {
    return { error: "invalid_input" };
  }
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("report_message", {
    p_message: messageId,
    p_reason: reason,
    p_note: trimmed === "" ? null : trimmed,
  });
  if (error) return { error: rpcErrorCode(error) };
  // report_new notices were created for the moderators: push them.
  schedulePushDispatch();
  return {};
}

/** Closes every open report of the same message as dismissed or actioned. */
export async function resolveReportAction(reportId: string, status: "dismissed" | "actioned"): Promise<Result> {
  if (typeof reportId !== "string" || !UUID_RE.test(reportId) || (status !== "dismissed" && status !== "actioned")) {
    return { error: "invalid_input" };
  }
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("resolve_report", { p_report: reportId, p_status: status });
  if (error) return { error: rpcErrorCode(error) };
  schedulePushDispatch();
  return {};
}
