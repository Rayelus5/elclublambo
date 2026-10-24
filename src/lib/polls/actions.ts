"use server";

import { rpcErrorCode, rpcErrorMessage } from "@/lib/errors";
import { normalizePollText, validatePollDraft } from "@/lib/polls/polls";
import { schedulePushDispatch } from "@/lib/push/schedule";
import { createServerClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

type Fail = { ok: false; error: string; code: string; slowmodeSeconds?: number };
const fail = (code: string): Fail => ({ ok: false, code, error: rpcErrorMessage(code) });

export async function createPollAction(input: {
  channelId: string;
  question: string;
  options: string[];
  closesAt: string;
}): Promise<{ ok: true; messageId: string } | Fail> {
  const { channelId, question, options, closesAt } = input ?? ({} as typeof input);
  if (!isUuid(channelId) || typeof question !== "string" || typeof closesAt !== "string") {
    return fail("invalid_input");
  }
  if (!Array.isArray(options) || options.some((o) => typeof o !== "string")) return fail("invalid_input");

  // Same rules as create_poll; the SQL judges again, this only saves the round trip.
  const check = validatePollDraft({ question, options, closesAt: new Date(closesAt), now: new Date() });
  if (!check.ok) return fail(check.code);

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("create_poll", {
    p_channel: channelId,
    p_question: normalizePollText(question),
    p_options: options.map(normalizePollText),
    p_closes_at: new Date(closesAt).toISOString(),
  });
  if (error) {
    const code = rpcErrorCode(error);
    if (code !== "slowmode") return fail(code);
    // The remaining seconds come in the error DETAIL; the composer starts its countdown with them.
    const n = Number.parseInt((error as { details?: string | null }).details ?? "", 10);
    return Number.isFinite(n) && n > 0 ? { ...fail(code), slowmodeSeconds: n } : fail(code);
  }
  if (!data) return fail("unknown");
  schedulePushDispatch();
  return { ok: true, messageId: String(data) };
}

export async function votePollAction(
  pollId: string,
  optionId: string,
): Promise<{ ok: true; status: "cast" | "changed" | "same"; voterCount: number } | Fail> {
  if (!isUuid(pollId) || !isUuid(optionId)) return fail("invalid_input");
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("cast_poll_vote", { p_poll: pollId, p_option: optionId });
  if (error) return fail(rpcErrorCode(error));
  const r = data as { status?: unknown; voterCount?: unknown } | null;
  if (!r || (r.status !== "cast" && r.status !== "changed" && r.status !== "same") || typeof r.voterCount !== "number") {
    return fail("unknown");
  }
  return { ok: true, status: r.status, voterCount: r.voterCount };
}
