import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ChannelTreeEditor } from "@/components/settings/channel-tree-editor";
import { getVisibleChannels } from "@/lib/channels/queries";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import { createServerClient } from "@/lib/supabase/server";

async function ChannelsContent() {
  const supabase = await createServerClient();
  const { data: rawPerms } = await supabase.rpc("my_permissions");
  if (!hasPerm(BigInt(String(rawPerms ?? 0)), Perm.MANAGE_CHANNELS)) notFound();
  const channels = await getVisibleChannels();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h2 className="text-h2">Canales</h2>
        <p className="text-fg-muted">
          Ordena el árbol arrastrando o con el teclado, cambia de padre con Mover a… y edita cada canal al
          seleccionarlo. Solo ves los canales que tú mismo puedes ver.
        </p>
      </header>
      <ChannelTreeEditor channels={channels} />
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
