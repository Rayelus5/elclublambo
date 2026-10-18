import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyAddressButton } from "@/components/members/copy-address-button";
import { SponsorTree, StatusBadge, type MemberSummary } from "@/components/members/sponsor-tree";
import { normalizeAddress } from "@/lib/auth/wallet";
import { MemberAvatar } from "@/components/members/member-avatar";
import { ProfileLinks } from "@/components/profile/profile-links";
import { HANDLE_RE } from "@/lib/members/handle";
import { identityFromRow, memberName } from "@/lib/members/name";
import { createServerClient } from "@/lib/supabase/server";

type DbMember = {
  id: string;
  wallet_address: string;
  display_name: string | null;
  handle: string | null;
  avatar_path: string | null;
  bio: string | null;
  links: unknown;
  status: "active" | "banned" | "left";
  invited_by_member_id: string | null;
  created_at: string;
};

const COLUMNS = "id, wallet_address, display_name, handle, avatar_path, bio, links, status, invited_by_member_id, created_at";

const toSummary = (m: DbMember): MemberSummary => ({
  id: m.id,
  ...identityFromRow(m),
  status: m.status,
});

const dateFmt = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "UTC" });

// Lee cookies (dinámico): con cacheComponents debe vivir dentro de un Suspense.
async function ProfileContent({ params }: { params: Promise<{ address: string }> }) {
  const { address: raw } = await params;
  let param: string;
  try {
    param = decodeURIComponent(raw).trim();
  } catch {
    notFound();
  }
  // 0x + 40 hex is a wallet; anything else is a handle (lowercased). Neither shape: 404.
  let lookup: { column: "wallet_address" | "handle"; value: string };
  if (/^0x[0-9a-fA-F]{40}$/.test(param)) {
    lookup = { column: "wallet_address", value: normalizeAddress(param) };
  } else {
    const handle = param.replace(/^@/, "").toLowerCase();
    if (!HANDLE_RE.test(handle)) notFound();
    lookup = { column: "handle", value: handle };
  }

  const supabase = await createServerClient();
  const [{ data: member }, me, domains] = await Promise.all([
    supabase.from("members").select(COLUMNS).eq(lookup.column, lookup.value).maybeSingle<DbMember>(),
    supabase.rpc("current_member_id"),
    supabase.from("allowed_domains").select("domain"),
  ]);
  if (!member) notFound();
  const isOwn = typeof me.data === "string" && me.data === member.id;
  const allowedDomains = (domains.data ?? []).map((d: { domain: string }) => d.domain);
  const links = Array.isArray(member.links) ? member.links.filter((l): l is string => typeof l === "string") : [];

  const [sponsorRes, inviteesRes] = await Promise.all([
    member.invited_by_member_id
      ? supabase.from("members").select(COLUMNS).eq("id", member.invited_by_member_id).maybeSingle<DbMember>()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("members")
      .select(COLUMNS)
      .eq("invited_by_member_id", member.id)
      .order("created_at", { ascending: true })
      .returns<DbMember[]>(),
  ]);

  if (sponsorRes.error) throw sponsorRes.error;
  if (inviteesRes.error) throw inviteesRes.error;

  const sponsor = sponsorRes.data ? toSummary(sponsorRes.data) : null;
  const invitees = (inviteesRes.data ?? []).map(toSummary);

  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <header className="flex flex-col gap-4">
        <MemberAvatar member={identityFromRow(member)} size={96} />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-h1">{memberName(identityFromRow(member))}</h1>
          <StatusBadge status={member.status} />
        </div>
        {member.handle && member.display_name?.trim() ? <p className="font-mono text-fg-muted">@{member.handle}</p> : null}
        {member.bio ? <p className="max-w-prose whitespace-pre-line break-words">{member.bio}</p> : null}
        <ProfileLinks links={links} allowedDomains={allowedDomains} />
        {isOwn ? (
          <Link
            href="/perfil"
            className="inline-flex min-h-11 items-center self-start rounded-control border border-border-strong px-4 text-sm font-bold text-fg outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            Editar perfil
          </Link>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <code className="font-mono text-[13px] break-all text-fg-muted">{member.wallet_address}</code>
          <CopyAddressButton address={member.wallet_address} />
        </div>
        <p className="text-fg-muted">
          Miembro desde <time dateTime={member.created_at}>{dateFmt.format(new Date(member.created_at))}</time>
        </p>
      </header>

      <SponsorTree sponsor={sponsor} invitees={invitees} />
    </div>
  );
}

export default function ProfilePage({ params }: { params: Promise<{ address: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-64" aria-hidden />}>
      <ProfileContent params={params} />
    </Suspense>
  );
}
