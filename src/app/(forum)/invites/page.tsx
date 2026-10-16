import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CreateInviteForm } from "@/components/invites/create-invite-form";
import { InviteList, type InviteRow } from "@/components/invites/invite-list";
import { inviteStatus } from "@/lib/invites/status";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import { createServerClient } from "@/lib/supabase/server";

type DbInvite = {
  id: string;
  code: string;
  created_by: string;
  max_uses: number;
  uses: number;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

// Lee cookies (dinámico): con cacheComponents debe vivir dentro de un Suspense.
async function InvitesContent() {
  const supabase = await createServerClient();
  const { data: rawPerms } = await supabase.rpc("my_permissions");
  const perms = BigInt(String(rawPerms ?? 0));
  if (!hasPerm(perms, Perm.CREATE_INVITES)) notFound();

  const { data: me } = await supabase.rpc("current_member_id");
  const { data } = me
    ? await supabase.from("invites").select("*").eq("created_by", me).order("created_at", { ascending: false })
    : { data: [] };

  const now = new Date();
  const rows: InviteRow[] = ((data ?? []) as DbInvite[]).map((inv) => ({
    id: inv.id,
    codePrefix: inv.code.slice(0, 4),
    uses: inv.uses,
    maxUses: inv.max_uses,
    expiresAt: inv.expires_at,
    createdAt: inv.created_at,
    status: inviteStatus(inv, now),
  }));

  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">Invitaciones</h1>
        <p className="text-fg-muted">
          Cada persona que entra con tu enlace queda ligada a ti como su padrino. Elige cuántas veces se puede
          usar y cuánto tiempo vale.
        </p>
      </header>

      <section aria-labelledby="nueva-invitacion" className="flex flex-col gap-4">
        <h2 id="nueva-invitacion" className="text-h2">
          Nueva invitación
        </h2>
        <CreateInviteForm />
      </section>

      <section aria-labelledby="mis-invitaciones" className="flex flex-col gap-4">
        <h2 id="mis-invitaciones" className="text-h2">
          Tus invitaciones
        </h2>
        <InviteList invites={rows} />
      </section>
    </div>
  );
}

export default function InvitesPage() {
  return (
    <Suspense fallback={<div className="min-h-64" aria-hidden />}>
      <InvitesContent />
    </Suspense>
  );
}
