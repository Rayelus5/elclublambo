import { clubPath } from "@/lib/club/paths";
import { Suspense } from "react";
import { PageLoader } from "@/components/shell/page-loader";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyAddressButton } from "@/components/members/copy-address-button";
import { SponsorTree, StatusBadge, type MemberSummary } from "@/components/members/sponsor-tree";
import { normalizeAddress } from "@/lib/auth/wallet";
import { MemberAvatar } from "@/components/members/member-avatar";
import { TipProfileButton } from "@/components/payments/tip-profile-button";
import { BountyRecordSection } from "@/components/profile/bounty-record";
import { ProfileLinks } from "@/components/profile/profile-links";
import { TipsReceived } from "@/components/profile/tips-received";
import { getMemberBountyRecord, getMemberUnpaidBounties } from "@/lib/bounties/queries";
import { getMemberTipTotals, getMemberTips } from "@/lib/payments/queries";
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

  // Exact totals per token over the enabled networks come from the server (uncapped); the list is the 20 most recent.
  // A failed read hides the section.
  const tipsPromise = Promise.all([getMemberTips(supabase, member.id), getMemberTipTotals(supabase, member.id)])
    .then(([entries, totals]) => ({ entries, totals }))
    .catch(() => null);
  // Only the bounties the viewer can see, on the enabled networks, are counted (the RPCs enforce it). A failed read
  // hides the section.
  const bountiesPromise = Promise.all([getMemberBountyRecord(supabase, member.id), getMemberUnpaidBounties(supabase, member.id)])
    .then(([record, unpaid]) => ({ record, unpaid }))
    .catch(() => null);
  const [sponsorRes, inviteesRes, tips, bounties] = await Promise.all([
    member.invited_by_member_id
      ? supabase.from("members").select(COLUMNS).eq("id", member.invited_by_member_id).maybeSingle<DbMember>()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("members")
      .select(COLUMNS)
      .eq("invited_by_member_id", member.id)
      .order("created_at", { ascending: true })
      .returns<DbMember[]>(),
    tipsPromise,
    bountiesPromise,
  ]);

  if (sponsorRes.error) throw sponsorRes.error;
  if (inviteesRes.error) throw inviteesRes.error;

  const sponsor = sponsorRes.data ? toSummary(sponsorRes.data) : null;
  const invitees = (inviteesRes.data ?? []).map(toSummary);

  const panel = "rounded-panel border border-border-strong bg-surface-2 p-4 sm:p-6";
  return (
    <div className="flex w-full flex-col gap-6">
      <header className={`${panel} flex flex-col gap-5 sm:flex-row sm:items-start`}>
        <MemberAvatar member={identityFromRow(member)} size={96} />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-h1 break-words">{memberName(identityFromRow(member))}</h1>
                <StatusBadge status={member.status} />
              </div>
              {member.handle && member.display_name?.trim() ? <p className="font-mono text-fg-muted">@{member.handle}</p> : null}
            </div>
            {isOwn ? (
              <Link
                href={clubPath("/perfil")}
                className="inline-flex min-h-11 items-center rounded-control border border-border-strong bg-surface px-4 text-sm font-bold text-fg outline-none hover:bg-bg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                Editar perfil
              </Link>
            ) : member.status === "active" ? (
              <TipProfileButton recipient={{ ...identityFromRow(member), id: member.id }} />
            ) : null}
          </div>
          {member.bio ? <p className="max-w-prose whitespace-pre-line break-words text-fg">{member.bio}</p> : null}
          <ProfileLinks links={links} allowedDomains={allowedDomains} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-[13px] text-fg-muted">
            <span className="flex min-w-0 items-center gap-2">
              <code className="font-mono break-all">{member.wallet_address}</code>
              <CopyAddressButton address={member.wallet_address} />
            </span>
            <span>
              Miembro desde <time dateTime={member.created_at}>{dateFmt.format(new Date(member.created_at))}</time>
            </span>
          </div>
        </div>
      </header>

      {tips || bounties ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {tips ? (
            <div className={panel}>
              <TipsReceived entries={tips.entries} totals={tips.totals} />
            </div>
          ) : null}
          {bounties ? (
            <div className={panel}>
              <BountyRecordSection record={bounties.record} unpaid={bounties.unpaid} />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={panel}>
        <SponsorTree sponsor={sponsor} invitees={invitees} />
      </div>
    </div>
  );
}

export default function ProfilePage({ params }: { params: Promise<{ address: string }> }) {
  return (
    <Suspense fallback={<PageLoader />}>
      <ProfileContent params={params} />
    </Suspense>
  );
}
