import "server-only";
import { cache } from "react";
import { createServerClient } from "@/lib/supabase/server";
import { parseLockState, type LockState } from "@/lib/channels/lock";
import type { ChannelDetailRow, ChannelKind, ChannelRow } from "@/lib/channels/tree";

export type ChannelDetail = ChannelDetailRow;

type DbChannel = {
  id: string;
  parent_id: string | null;
  kind: ChannelKind;
  name: string;
  topic: string | null;
  position: number;
  slowmode_seconds: number;
  tickets_enabled: boolean;
  alpha_enabled: boolean;
  gate_min_share_bps: number | null;
  gate_min_net_usdc: number | string | null;
  gate_scope: "view" | "post";
};

const COLUMNS =
  "id, parent_id, kind, name, topic, position, slowmode_seconds, tickets_enabled, alpha_enabled, gate_min_share_bps, gate_min_net_usdc, gate_scope";

/** numeric(78,0) arrives as a JSON number (or string): keep it as an exact base-units string when it is safe. */
function netToString(v: number | string | null): string | null {
  if (v === null) return null;
  if (typeof v === "number") return Number.isSafeInteger(v) ? String(v) : BigInt(Math.trunc(v)).toString();
  return v;
}

const toDetail = (c: DbChannel): ChannelDetail => ({
  id: c.id,
  parentId: c.parent_id,
  kind: c.kind,
  name: c.name,
  topic: c.topic,
  position: c.position,
  slowmodeSeconds: c.slowmode_seconds,
  ticketsEnabled: c.tickets_enabled,
  alphaEnabled: c.alpha_enabled,
  gate: { minShareBps: c.gate_min_share_bps, minNetUsdc: netToString(c.gate_min_net_usdc), scope: c.gate_scope },
});

/**
 * Canales que el miembro puede ver, con todos sus ajustes (la RLS de `channels` ya filtra con can_view).
 * Memoizada por petición con `cache()`: el layout, la página y el editor comparten una sola consulta.
 * Dinámico: usar dentro de Suspense.
 */
export const getVisibleChannels = cache(async (): Promise<ChannelDetail[]> => {
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("channels").select(COLUMNS).returns<DbChannel[]>();
  if (error) throw error;
  return (data ?? []).map(toDetail);
});

type DbLocked = { id: string; parent_id: string | null; kind: ChannelKind; name: string; position: number; scope: string };

/**
 * Canales que el miembro vería si no fuera por un candado de visibilidad de la DAO (`locked_channels()`), como filas
 * del árbol con `locked`. Solo nombre/tipo/padre/posición: nada de contenido. Memoizada por petición.
 */
export const getLockedChannels = cache(async (): Promise<ChannelRow[]> => {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("locked_channels");
  // The sidebar must not break because the lock list failed: show the visible channels only.
  if (error) return [];
  return ((data ?? []) as unknown as DbLocked[]).map((c) => ({
    id: c.id,
    parentId: c.parent_id,
    kind: c.kind,
    name: c.name,
    topic: null,
    position: c.position,
    locked: true,
  }));
});

/** Estado de candado de un canal (RPC `channel_lock_state`), o null si no hay candado que le afecte. */
export const getLockState = cache(async (channelId: string): Promise<LockState | null> => {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("channel_lock_state", { p_channel: channelId });
  if (error) return null;
  return parseLockState(data);
});

/** Serializable para el cliente: solo las columnas del árbol. */
export const toRow = ({ id, parentId, kind, name, topic, position }: ChannelDetail): ChannelRow => ({
  id,
  parentId,
  kind,
  name,
  topic,
  position,
});
