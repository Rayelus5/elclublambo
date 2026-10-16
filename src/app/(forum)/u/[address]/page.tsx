import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CopyAddressButton } from "@/components/members/copy-address-button";
import { SponsorTree, StatusBadge, type MemberSummary } from "@/components/members/sponsor-tree";
import { normalizeAddress, shortAddress } from "@/lib/auth/wallet";
import { createServerClient } from "@/lib/supabase/server";

type DbMember = {
  id: string;
  wallet_address: string;
  display_name: string | null;
  status: "active" | "banned" | "left";
  invited_by_member_id: string | null;
  created_at: string;
};

const COLUMNS = "id, wallet_address, display_name, status, invited_by_member_id, created_at";

const toSummary = (m: DbMember): MemberSummary => ({
  id: m.id,
  walletAddress: m.wallet_address,
  displayName: m.display_name,
  status: m.status,
});

const dateFmt = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "UTC" });

// Lee cookies (dinámico): con cacheComponents debe vivir dentro de un Suspense.
async function ProfileContent({ params }: { params: Promise<{ address: string }> }) {
  const { address: raw } = await params;
  let address: string;
  try {
    address = normalizeAddress(decodeURIComponent(raw));
  } catch {
    notFound();
  }

  const supabase = await createServerClient();
  const { data: member } = await supabase
    .from("members")
    .select(COLUMNS)
    .eq("wallet_address", address)
    .maybeSingle<DbMember>();
  if (!member) notFound();

  const [sponsorRes, inviteesRes] = await Promise.all([
    member.invited_by_member_id
      ? supabase.from("members").select(COLUMNS).eq("id", member.invited_by_member_id).maybeSingle<DbMember>()
      : Promise.resolve({ data: null }),
    supabase
      .from("members")
      .select(COLUMNS)
      .eq("invited_by_member_id", member.id)
      .order("created_at", { ascending: true })
      .returns<DbMember[]>(),
  ]);

  const sponsor = sponsorRes.data ? toSummary(sponsorRes.data) : null;
  const invitees = (inviteesRes.data ?? []).map(toSummary);

  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-h1">{member.display_name ?? shortAddress(member.wallet_address)}</h1>
          <StatusBadge status={member.status} />
        </div>
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
