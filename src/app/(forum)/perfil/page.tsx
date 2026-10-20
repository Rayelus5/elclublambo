import { Suspense } from "react";
import { PageLoader } from "@/components/shell/page-loader";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DensityToggle } from "@/components/chat/density";
import { AvatarUpload } from "@/components/profile/avatar-upload";
import { ProfileForm } from "@/components/profile/profile-form";
import { RankingToggle } from "@/components/treasury/ranking-toggle";
import { identityFromRow, MEMBER_IDENTITY_COLUMNS, type MemberIdentityRow } from "@/lib/members/name";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar perfil" };

type Row = MemberIdentityRow & { bio: string | null; links: unknown; handle_changed_at: string | null; dao_ranking_visible: boolean };

const COOLDOWN_MS = 30 * 86_400_000;

/** ISO date when the handle can change again, or null when it can change now. */
function handleNextChange(handle: string | null, changedAt: string | null): string | null {
  if (!handle || !changedAt) return null;
  const next = new Date(changedAt).getTime() + COOLDOWN_MS;
  return next > Date.now() ? new Date(next).toISOString() : null;
}

// Lee cookies (dinámico): con cacheComponents debe vivir dentro de un Suspense.
async function EditProfile() {
  const supabase = await createServerClient();
  const me = await supabase.rpc("current_member_id");
  if (me.error || typeof me.data !== "string") notFound();
  const { data: row } = await supabase
    .from("members")
    .select(`${MEMBER_IDENTITY_COLUMNS}, bio, links, handle_changed_at, dao_ranking_visible`)
    .eq("id", me.data)
    .maybeSingle<Row>();
  if (!row) notFound();

  const links = Array.isArray(row.links) ? row.links.filter((l): l is string => typeof l === "string") : [];

  return (
    <div className="flex max-w-2xl flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">Editar perfil</h1>
        <Link
          href={`/u/${row.handle ?? row.wallet_address}`}
          className="inline-flex min-h-11 items-center self-start text-accent underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          Ver mi perfil
        </Link>
      </header>
      <AvatarUpload member={identityFromRow(row)} />
      <ProfileForm
        handle={row.handle}
        displayName={row.display_name ?? ""}
        bio={row.bio ?? ""}
        links={links}
        handleNextChangeAt={handleNextChange(row.handle, row.handle_changed_at)}
      />
      <section aria-labelledby="dao-privacy" className="flex flex-col gap-3">
        <h2 id="dao-privacy" className="text-h2">
          Privacidad en la DAO
        </h2>
        <RankingToggle initial={row.dao_ranking_visible === true} id="perfil-dao-ranking-visible" />
      </section>
      <section aria-labelledby="chat-density" className="flex flex-col gap-3">
        <h2 id="chat-density" className="text-h2">
          Vista del chat
        </h2>
        <p className="text-sm text-fg-muted">
          Compacto reduce el tamaño del avatar y el espacio entre mensajes para ver más conversación a la vez. Se aplica a
          todos los canales de texto y también puedes cambiarlo desde cualquier canal.
        </p>
        <DensityToggle className="self-start" />
      </section>
    </div>
  );
}

export default function PerfilPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <EditProfile />
    </Suspense>
  );
}
