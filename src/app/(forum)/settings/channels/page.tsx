import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ChannelTreeEditor, type MatrixData } from "@/components/settings/channel-tree-editor";
import type { OverwriteRow } from "@/components/settings/permission-matrix";
import { getVisibleChannels } from "@/lib/channels/queries";
import { CHANNEL_MASK, hasPerm, Perm } from "@/lib/permissions/bits";
import { getRolesContext } from "@/lib/roles/queries";
import { createServerClient } from "@/lib/supabase/server";

type DbOverwrite = { channel_id: string; target_type: "role" | "member"; target_id: string; allow: number | string; deny: number | string };
type DbMember = { id: string; display_name: string | null; wallet_address: string };

async function ChannelsContent() {
  const supabase = await createServerClient();
  const { data: rawPerms } = await supabase.rpc("my_permissions");
  if (!hasPerm(BigInt(String(rawPerms ?? 0)), Perm.MANAGE_CHANNELS)) notFound();
  const [channels, { roles, actor }] = await Promise.all([getVisibleChannels(), getRolesContext()]);

  const { data: dbOverwrites, error } = await supabase
    .from("permission_overwrites")
    .select("channel_id, target_type, target_id, allow, deny")
    .returns<DbOverwrite[]>();
  if (error) throw error;

  const overwritesByChannel: Record<string, OverwriteRow[]> = {};
  const memberIds = new Set<string>();
  for (const o of dbOverwrites ?? []) {
    (overwritesByChannel[o.channel_id] ??= []).push({
      targetType: o.target_type,
      targetId: o.target_id,
      allow: String(o.allow),
      deny: String(o.deny),
    });
    if (o.target_type === "member") memberIds.add(o.target_id);
  }

  let members: MatrixData["members"] = [];
  if (memberIds.size > 0) {
    const { data } = await supabase
      .from("members")
      .select("id, display_name, wallet_address")
      .in("id", [...memberIds])
      .returns<DbMember[]>();
    members = (data ?? []).map((m) => ({ id: m.id, displayName: m.display_name, walletAddress: m.wallet_address }));
  }

  // Bits de canal del actor por canal (el admin los tiene todos sin consultar).
  const channelPerms: Record<string, string> = {};
  if (actor.isAdmin) {
    for (const c of channels) channelPerms[c.id] = CHANNEL_MASK.toString();
  } else {
    const entries = await Promise.all(
      channels.map(async (c) => {
        const { data } = await supabase.rpc("my_channel_permissions", { p_channel: c.id });
        return [c.id, String(data ?? 0)] as const;
      }),
    );
    for (const [id, bits] of entries) channelPerms[id] = bits;
  }

  const matrix: MatrixData = {
    overwritesByChannel,
    channelPerms,
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      position: r.position,
      isEveryone: r.isEveryone,
      isAdminRole: (BigInt(r.permissions) & Perm.ADMINISTRATOR) !== 0n,
    })),
    members,
    isAdmin: actor.isAdmin,
    actorTop: actor.top,
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h2 className="text-h2">Canales</h2>
        <p className="text-fg-muted">
          Ordena el árbol arrastrando o con el teclado, cambia de padre con Mover a… y edita cada canal al
          seleccionarlo. Solo ves los canales que tú mismo puedes ver.
        </p>
      </header>
      <ChannelTreeEditor channels={channels} matrix={matrix} />
    </div>
  );
}

export default function ChannelsSettingsPage() {
  return (
    <Suspense fallback={<div className="min-h-64" aria-hidden />}>
      <ChannelsContent />
    </Suspense>
  );
}
