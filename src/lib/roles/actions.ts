"use server";

import { revalidatePath } from "next/cache";
import { rpcErrorCode } from "@/lib/errors";
import { ALL_PERMS, Perm } from "@/lib/permissions/bits";
import { createServerClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const NAME_MAX = 32;

const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const n = v.trim();
  return n.length >= 1 && n.length <= NAME_MAX ? n : null;
}

function cleanColor(v: unknown): string | null {
  return typeof v === "string" && COLOR_RE.test(v) ? v.toUpperCase() : null;
}

/** El bit 512 (ADMINISTRATOR) nunca se concede desde la UI. */
function cleanPerms(v: unknown): number | null {
  if (typeof v !== "string" || !/^\d{1,5}$/.test(v)) return null;
  const n = BigInt(v);
  return n <= ALL_PERMS && (n & Perm.ADMINISTRATOR) === 0n ? Number(n) : null;
}

function refresh() {
  revalidatePath("/settings/roles");
  revalidatePath("/settings/channels");
  revalidatePath("/", "layout");
}

export async function createRoleAction(input: {
  name: string;
  color: string;
  permissions: string;
}): Promise<{ id?: string; error?: string }> {
  const name = cleanName(input?.name);
  const color = cleanColor(input?.color);
  const permissions = cleanPerms(input?.permissions);
  if (!name || !color || permissions === null) return { error: "invalid_input" };

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("create_role", {
    p_name: name,
    p_color: color,
    p_permissions: permissions,
  });
  if (error) return { error: rpcErrorCode(error) };
  refresh();
  return { id: typeof data === "string" ? data : undefined };
}

export async function updateRoleAction(input: {
  id: string;
  name: string;
  color: string;
  permissions: string;
}): Promise<{ error?: string }> {
  const name = cleanName(input?.name);
  const color = cleanColor(input?.color);
  const permissions = cleanPerms(input?.permissions);
  if (!isUuid(input?.id) || !name || !color || permissions === null) return { error: "invalid_input" };

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("update_role", {
    p_role: input.id,
    p_name: name,
    p_color: color,
    p_permissions: permissions,
  });
  if (error) return { error: rpcErrorCode(error) };
  refresh();
  return {};
}

export async function deleteRoleAction(id: string): Promise<{ error?: string }> {
  if (!isUuid(id)) return { error: "invalid_input" };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("delete_role", { p_role: id });
  if (error) return { error: rpcErrorCode(error) };
  refresh();
  return {};
}

export async function moveRoleAction(id: string, position: number): Promise<{ error?: string }> {
  if (!isUuid(id) || !Number.isInteger(position) || position < 1) return { error: "invalid_input" };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("move_role", { p_role: id, p_position: position });
  if (error) return { error: rpcErrorCode(error) };
  refresh();
  return {};
}
