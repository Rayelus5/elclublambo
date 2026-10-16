"use server";

import { revalidatePath } from "next/cache";
import { rpcErrorCode } from "@/lib/errors";
import { createServerClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["category", "forum", "text"];
const NAME_MAX = 50;
const TOPIC_MAX = 300;
const SLOWMODE_MIN = 5;
const SLOWMODE_MAX = 604800;

const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.trim();
  return name.length >= 1 && name.length <= NAME_MAX ? name : null;
}

/** Devuelve null si es inválido; "" se normaliza a null dentro de `{ value }`. */
function cleanTopic(v: unknown): { value: string | null } | null {
  if (v === null || v === undefined) return { value: null };
  if (typeof v !== "string") return null;
  const topic = v.trim();
  if (topic.length > TOPIC_MAX) return null;
  return { value: topic === "" ? null : topic };
}

function refresh() {
  revalidatePath("/settings/channels");
  revalidatePath("/", "layout");
}

export async function createChannelAction(input: {
  parentId: string | null;
  kind: string;
  name: string;
  topic?: string | null;
}): Promise<{ id?: string; error?: string }> {
  const name = cleanName(input?.name);
  const topic = cleanTopic(input?.topic);
  const parentOk = input?.parentId === null || isUuid(input?.parentId);
  if (!name || !topic || !parentOk || !KINDS.includes(input.kind)) return { error: "invalid_input" };

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("create_channel", {
    p_parent: input.parentId,
    p_kind: input.kind,
    p_name: name,
    p_topic: topic.value,
  });
  if (error) return { error: rpcErrorCode(error) };
  refresh();
  return { id: typeof data === "string" ? data : undefined };
}

export async function updateChannelAction(input: {
  id: string;
  name: string;
  topic: string | null;
  slowmodeSeconds: number;
  ticketsEnabled: boolean;
  alphaEnabled: boolean;
}): Promise<{ error?: string }> {
  const name = cleanName(input?.name);
  const topic = cleanTopic(input?.topic);
  const s = input?.slowmodeSeconds;
  const slowOk = Number.isInteger(s) && (s === 0 || (s >= SLOWMODE_MIN && s <= SLOWMODE_MAX));
  if (!isUuid(input?.id) || !name || !topic || !slowOk) return { error: "invalid_input" };

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("update_channel", {
    p_id: input.id,
    p_name: name,
    p_topic: topic.value,
    p_slowmode: s,
    p_tickets: input.ticketsEnabled === true,
    p_alpha: input.alphaEnabled === true,
  });
  if (error) return { error: rpcErrorCode(error) };
  refresh();
  return {};
}

/** `index` es la posición final entre los hermanos del padre destino; null = al final. */
export async function moveChannelAction(input: {
  id: string;
  parentId: string | null;
  index: number | null;
}): Promise<{ error?: string }> {
  const indexOk = input?.index === null || (Number.isInteger(input?.index) && input.index >= 0);
  const parentOk = input?.parentId === null || isUuid(input?.parentId);
  if (!isUuid(input?.id) || !parentOk || !indexOk) return { error: "invalid_input" };

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("move_channel", {
    p_id: input.id,
    p_new_parent: input.parentId,
    p_index: input.index,
  });
  if (error) return { error: rpcErrorCode(error) };
  refresh();
  return {};
}

export async function deleteChannelAction(id: string): Promise<{ error?: string }> {
  if (!isUuid(id)) return { error: "invalid_input" };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("delete_channel", { p_id: id });
  if (error) return { error: rpcErrorCode(error) };
  refresh();
  return {};
}
