import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import type { ChannelKind, ChannelRow } from "@/lib/channels/tree";

export type ChannelDetail = ChannelRow & {
  slowmodeSeconds: number;
  ticketsEnabled: boolean;
  alphaEnabled: boolean;
};

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
};

const COLUMNS = "id, parent_id, kind, name, topic, position, slowmode_seconds, tickets_enabled, alpha_enabled";

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
});

/** Canales que el miembro puede ver (la RLS de `channels` ya filtra con can_view). Dinámico: usar dentro de Suspense. */
export async function getVisibleChannels(): Promise<ChannelDetail[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("channels").select(COLUMNS).returns<DbChannel[]>();
  if (error) throw error;
  return (data ?? []).map(toDetail);
}

/** Serializable para el cliente: solo las columnas del árbol. */
export const toRow = ({ id, parentId, kind, name, topic, position }: ChannelDetail): ChannelRow => ({
  id,
  parentId,
  kind,
  name,
  topic,
  position,
});
