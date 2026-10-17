"use server";

import { docToPlainText, sanitizeDoc } from "@/lib/chat/content";
import type { MentionSearchResult } from "@/lib/chat/mentions";
import { rpcErrorCode } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

// No revalidatePath on purpose: the chat UI is driven by realtime events, not by server re-renders.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpe?g|webp|gif)$/;
const MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_ATTACHMENTS = 4;
const MAX_EMOJI_BYTES = 32;

const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export type AttachmentInput = { path: string; mime: string; size: number; width: number; height: number };
export type ActionResult = { error?: string };

function cleanAttachments(raw: unknown): AttachmentInput[] | "too_many" | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_ATTACHMENTS) return "too_many";
  const out: AttachmentInput[] = [];
  for (const a of raw as Record<string, unknown>[]) {
    if (
      typeof a !== "object" ||
      a === null ||
      typeof a.path !== "string" ||
      !PATH_RE.test(a.path) ||
      typeof a.mime !== "string" ||
      !MIMES.has(a.mime) ||
      !Number.isInteger(a.size) ||
      (a.size as number) < 1
    ) {
      return null;
    }
    const dim = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) <= 99999 ? (v as number) : 0);
    out.push({ path: a.path, mime: a.mime, size: a.size as number, width: dim(a.width), height: dim(a.height) });
  }
  return out;
}

/** Seconds from the `slowmode` error DETAIL (supabase-js: error.details). */
function slowmodeSeconds(error: { details?: string | null }): number | undefined {
  const n = Number.parseInt(error.details ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export async function postMessageAction(input: {
  channelId: string;
  doc: unknown;
  expanded: boolean;
  threadRootId?: string | null;
  quotedId?: string | null;
  attachments?: AttachmentInput[];
}): Promise<{ id?: string; error?: string; slowmodeSeconds?: number }> {
  if (!isUuid(input.channelId)) return { error: "invalid_input" };
  if (input.threadRootId != null && !isUuid(input.threadRootId)) return { error: "invalid_input" };
  if (input.quotedId != null && !isUuid(input.quotedId)) return { error: "invalid_input" };
  const attachments = cleanAttachments(input.attachments);
  if (attachments === "too_many") return { error: "too_many_attachments" };
  if (attachments === null) return { error: "invalid_input" };

  // Never trust the client doc or its text: sanitize and derive here (the SQL derives it again).
  const doc = sanitizeDoc(input.doc);
  const text = docToPlainText(doc);
  if (text === "" && attachments.length === 0) return { error: "invalid_input" };

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("post_message", {
    p_channel: input.channelId,
    p_body: doc,
    p_body_text: text,
    p_expanded: input.expanded === true,
    p_thread_root: input.threadRootId ?? null,
    p_quoted: input.quotedId ?? null,
    p_attachments: attachments,
  });
  if (error) {
    const code = rpcErrorCode(error);
    return code === "slowmode" ? { error: code, slowmodeSeconds: slowmodeSeconds(error) } : { error: code };
  }
  return { id: String(data) };
}

export async function editMessageAction(input: { id: string; doc: unknown }): Promise<ActionResult> {
  if (!isUuid(input.id)) return { error: "invalid_input" };
  const doc = sanitizeDoc(input.doc);
  // An empty text is allowed when the message has attachments (clearing an image caption): SQL decides.
  const text = docToPlainText(doc);
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("edit_message", { p_id: input.id, p_body: doc, p_body_text: text });
  return error ? { error: rpcErrorCode(error) } : {};
}

export async function deleteMessageAction(id: string): Promise<ActionResult> {
  if (!isUuid(id)) return { error: "invalid_input" };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("delete_message", { p_id: id });
  if (error) return { error: rpcErrorCode(error) };
  // The message is already gone; leftover objects are best-effort and must not fail the action.
  const raw = (data as { paths?: unknown } | null)?.paths;
  const paths = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
  if (paths.length > 0) {
    const bucket = createAdminClient().storage.from("chat-images");
    for (let i = 0; i < paths.length; i += 1000) {
      try {
        const { error: storageError } = await bucket.remove(paths.slice(i, i + 1000));
        if (storageError) {
          const code = (storageError as { statusCode?: string }).statusCode ?? "unknown";
          console.error(`deleteMessageAction: storage cleanup failed (${code}): ${storageError.message}`);
        }
      } catch (e) {
        console.error(`deleteMessageAction: storage cleanup threw: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }
  }
  return {};
}

export async function toggleReactionAction(input: {
  messageId: string;
  emoji: string;
}): Promise<{ active?: boolean; error?: string }> {
  const emoji = typeof input.emoji === "string" ? input.emoji : "";
  if (!isUuid(input.messageId) || emoji === "" || new TextEncoder().encode(emoji).length > MAX_EMOJI_BYTES) {
    return { error: "invalid_input" };
  }
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("toggle_reaction", { p_message: input.messageId, p_emoji: emoji });
  return error ? { error: rpcErrorCode(error) } : { active: data === true };
}

export async function setPinnedAction(input: { messageId: string; pinned: boolean }): Promise<ActionResult> {
  if (!isUuid(input.messageId)) return { error: "invalid_input" };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_pinned", { p_message: input.messageId, p_pinned: input.pinned === true });
  return error ? { error: rpcErrorCode(error) } : {};
}

export async function markReadAction(channelId: string): Promise<ActionResult> {
  if (!isUuid(channelId)) return { error: "invalid_input" };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("mark_channel_read", { p_channel: channelId });
  return error ? { error: rpcErrorCode(error) } : {};
}

/** Remaining slowmode seconds according to the database clock (never the client's). */
export async function getSlowmodeAction(channelId: string): Promise<{ seconds: number; error?: string }> {
  if (!isUuid(channelId)) return { seconds: 0, error: "invalid_input" };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("my_slowmode_remaining", { p_channel: channelId });
  if (error) return { seconds: 0, error: rpcErrorCode(error) };
  const n = Number(data ?? 0);
  return { seconds: Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0 };
}

/** Members (active, by name or wallet) and roles (all but @everyone) for the mention picker. */
export async function searchMentionTargetsAction(query: string): Promise<MentionSearchResult> {
  const empty: MentionSearchResult = { members: [], roles: [] };
  if (typeof query !== "string") return empty;
  // No PostgREST filter metacharacters; whitespace collapsed. % and _ are kept but escaped below so they
  // match literally (a member named "foo_bar" is found by "foo_bar").
  const clean = query
    .replace(/[,()*\\:"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (clean.length > 42) return empty;
  const q = clean.replace(/[%_]/g, "\\$&");

  const supabase = await createServerClient();
  let rolesQuery = supabase.from("roles").select("id, name").eq("is_everyone", false);
  if (q !== "") rolesQuery = rolesQuery.ilike("name", `%${q}%`);
  const rolesPromise = rolesQuery.order("position", { ascending: false }).limit(8);
  const membersPromise =
    q === ""
      ? null
      : supabase
          .from("members")
          .select("id, display_name, wallet_address")
          .eq("status", "active")
          .or(`display_name.ilike.%${q}%,wallet_address.ilike.%${q}%`)
          .limit(8);

  const [roles, members] = await Promise.all([rolesPromise, membersPromise]);
  return {
    members:
      members && !members.error && members.data
        ? (members.data as { id: string; display_name: string | null; wallet_address: string }[]).map((m) => ({
            id: m.id,
            label: m.display_name ?? "",
            walletAddress: m.wallet_address,
          }))
        : [],
    roles:
      !roles.error && roles.data ? (roles.data as { id: string; name: string }[]).map((r) => ({ id: r.id, label: r.name })) : [],
  };
}
