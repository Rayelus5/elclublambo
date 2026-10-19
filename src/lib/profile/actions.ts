"use server";

import { safeError } from "@/lib/security/redact";
import { revalidatePath } from "next/cache";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/errors";
import { normalizeHandle } from "@/lib/members/handle";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

const fail = (code: string): { ok: false; error: string } => ({ ok: false, error: rpcErrorMessage(code) });

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const AVATAR_OBJECT_RE = new RegExp(`^(${UUID})/${UUID}\\.(png|jpg|webp)$`);

function refresh() {
  revalidatePath("/u/[address]", "page");
  revalidatePath("/perfil");
}

export async function saveProfileAction(input: { displayName: string; bio: string; links: string[] }): Promise<ActionResult> {
  if (
    !input ||
    typeof input.displayName !== "string" ||
    typeof input.bio !== "string" ||
    !Array.isArray(input.links) ||
    !input.links.every((l) => typeof l === "string")
  ) {
    return fail("invalid_input");
  }
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("update_profile", {
    p_display_name: input.displayName.trim(),
    p_bio: input.bio.trim(),
    p_links: input.links.map((l) => l.trim()).filter(Boolean),
  });
  if (error) return fail(rpcErrorCode(error));
  refresh();
  return { ok: true };
}

export async function setHandleAction(handle: string): Promise<{ ok: true; handle: string } | { ok: false; error: string }> {
  const n = normalizeHandle(typeof handle === "string" ? handle : "");
  if (!n.ok) return fail(n.error);
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("set_handle", { p_handle: n.handle });
  if (error) return fail(rpcErrorCode(error));
  refresh();
  return { ok: true, handle: typeof data === "string" ? data : n.handle };
}

/** Removes an avatar object, only ever from the caller's own folder; failures are logged, never thrown. */
async function removeOwnAvatar(memberId: string, path: string | null) {
  if (!path) return;
  const m = AVATAR_OBJECT_RE.exec(path);
  if (!m || m[1] !== memberId.toLowerCase()) return;
  try {
    const { error } = await createAdminClient().storage.from("avatars").remove([path]);
    if (error) console.error(`setAvatarAction: avatar cleanup failed: ${safeError(error.message)}`);
  } catch (e) {
    console.error(`setAvatarAction: avatar cleanup threw: ${safeError(e)}`);
  }
}

/** Removes the replaced avatar object. Only ever touches the caller's own folder; failures are logged, never thrown. */
async function deleteOldAvatar(memberId: string, previous: string | null, next: string | null) {
  if (!previous || previous === next) return;
  await removeOwnAvatar(memberId, previous);
}

export async function setAvatarAction(path: string | null): Promise<ActionResult> {
  if (path !== null && typeof path !== "string") return fail("avatar_invalid");
  const supabase = await createServerClient();
  const me = await supabase.rpc("current_member_id");
  if (me.error || typeof me.data !== "string") return fail("not_member");
  const memberId = me.data;

  const { data: cur } = await supabase.from("members").select("avatar_path").eq("id", memberId).maybeSingle<{ avatar_path: string | null }>();
  const previous = cur?.avatar_path ?? null;

  const { error } = await supabase.rpc("set_avatar", { p_path: path });
  if (error) {
    // Best effort: the client already uploaded `path`; do not leave it orphaned.
    await removeOwnAvatar(memberId, path);
    return fail(rpcErrorCode(error));
  }

  await deleteOldAvatar(memberId, previous, path);
  refresh();
  return { ok: true };
}
