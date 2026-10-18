"use server";

import { revalidatePath } from "next/cache";
import { rpcErrorCode } from "@/lib/errors";
import { identityFromRow, MEMBER_IDENTITY_COLUMNS, type MemberIdentity, type MemberIdentityRow } from "@/lib/members/name";
import { CHANNEL_MASK, hasPerm, Perm } from "@/lib/permissions/bits";
import { createAdminClient } from "@/lib/supabase/admin";
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

const NET_MAX = 10n ** 30n;

/**
 * Guarda el candado de la DAO de un canal (`set_channel_gate`): % mínimo en bps y/o aportación neta mínima en unidades
 * base de USDC (string), unidos con "o". Ambos null lo quitan. La autorización real la hace la RPC.
 */
export async function setChannelGateAction(input: {
  id: string;
  minShareBps: number | null;
  minNetUsdc: string | null;
  scope: string;
}): Promise<{ error?: string }> {
  const shareOk =
    input?.minShareBps === null || (Number.isInteger(input?.minShareBps) && input.minShareBps >= 0 && input.minShareBps <= 10_000);
  const netOk =
    input?.minNetUsdc === null || (typeof input?.minNetUsdc === "string" && /^\d{1,31}$/.test(input.minNetUsdc) && BigInt(input.minNetUsdc) <= NET_MAX);
  if (!isUuid(input?.id) || !shareOk || !netOk || (input.scope !== "view" && input.scope !== "post")) {
    return { error: "invalid_input" };
  }

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_channel_gate", {
    p_channel: input.id,
    p_min_share_bps: input.minShareBps,
    p_min_net_usdc: input.minNetUsdc,
    p_scope: input.scope,
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

const BIGINT_RE = /^\d{1,6}$/;

/**
 * Guarda (o borra con 0/0) el overwrite de un rol o miembro. allow/deny llegan como string de bigint,
 * solo con bits de canal y sin solaparse; la autorización real la hace la RPC.
 */
export async function setOverwriteAction(
  channelId: string,
  targetType: "role" | "member",
  targetId: string,
  allow: string,
  deny: string,
): Promise<{ error?: string }> {
  if (!isUuid(channelId) || !isUuid(targetId) || (targetType !== "role" && targetType !== "member")) {
    return { error: "invalid_input" };
  }
  if (typeof allow !== "string" || typeof deny !== "string" || !BIGINT_RE.test(allow) || !BIGINT_RE.test(deny)) {
    return { error: "invalid_input" };
  }
  const a = BigInt(allow);
  const d = BigInt(deny);
  if ((a & ~CHANNEL_MASK) !== 0n || (d & ~CHANNEL_MASK) !== 0n || (a & d) !== 0n) {
    return { error: "invalid_input" };
  }

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_overwrite", {
    p_channel: channelId,
    p_target_type: targetType,
    p_target: targetId,
    p_allow: Number(a),
    p_deny: Number(d),
  });
  if (error) return { error: rpcErrorCode(error) };
  refresh();
  return {};
}

export type MemberHit = MemberIdentity & { id: string };

/** Bits de canal del actor en un canal; se pide solo para el canal seleccionado en el editor. */
export async function getMyChannelPermsAction(channelId: string): Promise<{ bits?: string; error?: string }> {
  if (!isUuid(channelId)) return { error: "invalid_input" };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("my_channel_permissions", { p_channel: channelId });
  if (error) return { error: rpcErrorCode(error) };
  return { bits: String(data ?? 0) };
}

/** Búsqueda de miembros activos por nombre o wallet para añadir un overwrite. Solo con MANAGE_CHANNELS o admin. */
export async function searchMembersAction(query: string): Promise<MemberHit[]> {
  if (typeof query !== "string") return [];
  // Fuera comodines y metacaracteres del filtro de PostgREST; los espacios se normalizan a uno solo.
  const q = query
    .replace(/[%_,()*\\:"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (q.length < 2 || q.length > 42) return [];
  const supabase = await createServerClient();
  const { data: rawPerms, error: permsError } = await supabase.rpc("my_permissions");
  if (permsError || !hasPerm(BigInt(String(rawPerms ?? 0)), Perm.MANAGE_CHANNELS)) return [];
  const { data, error } = await supabase
    .from("members")
    .select(`id, ${MEMBER_IDENTITY_COLUMNS}`)
    .eq("status", "active")
    .or(`display_name.ilike.%${q}%,handle.ilike.%${q}%,wallet_address.ilike.%${q}%`)
    .limit(10);
  if (error || !data) return [];
  return (data as Array<{ id: string } & MemberIdentityRow>).map((m) => ({ id: m.id, ...identityFromRow(m) }));
}

export async function deleteChannelAction(id: string): Promise<{ error?: string }> {
  if (!isUuid(id)) return { error: "invalid_input" };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("delete_channel", { p_id: id });
  if (error) return { error: rpcErrorCode(error) };
  // The channel is already gone; leftover objects are best-effort (bucket may not exist yet).
  const raw = (data as { paths?: unknown } | null)?.paths;
  const paths = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
  if (paths.length > 0) {
    const bucket = createAdminClient().storage.from("chat-images");
    for (let i = 0; i < paths.length; i += 1000) {
      try {
        const { error: storageError } = await bucket.remove(paths.slice(i, i + 1000));
        if (storageError) {
          const code = (storageError as { statusCode?: string }).statusCode ?? "unknown";
          console.error(`deleteChannelAction: storage cleanup failed (${code}): ${storageError.message}`);
        }
      } catch (e) {
        console.error(`deleteChannelAction: storage cleanup threw: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }
  }
  refresh();
  return {};
}
