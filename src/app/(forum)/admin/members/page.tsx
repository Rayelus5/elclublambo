import { Suspense } from "react";
import { PageLoader } from "@/components/shell/page-loader";
import { notFound } from "next/navigation";
import { MemberTable, type AdminMemberRow } from "@/components/members/member-table";
import type { MemberSummary } from "@/components/members/sponsor-tree";
import { identityFromRow } from "@/lib/members/name";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import { createServerClient } from "@/lib/supabase/server";

type DbMember = {
  id: string;
  wallet_address: string;
  display_name: string | null;
  handle: string | null;
  avatar_path: string | null;
  status: "active" | "banned" | "left";
  invited_by_member_id: string | null;
  needs_review_since: string | null;
  created_at: string;
};

const toSummary = (m: DbMember): MemberSummary => ({
  id: m.id,
  ...identityFromRow(m),
  status: m.status,
});

// Lee cookies (dinámico): con cacheComponents debe vivir dentro de un Suspense.
async function MembersContent() {
  const supabase = await createServerClient();
  const { data: rawPerms } = await supabase.rpc("my_permissions");
  const perms = BigInt(String(rawPerms ?? 0));
  if (!hasPerm(perms, Perm.BAN_MEMBERS) && !hasPerm(perms, Perm.VERIFY_MEMBERS)) notFound();

  const { data: me, error: meError } = await supabase.rpc("current_member_id");
  if (meError) throw meError;

  const { data: members, error } = await supabase
    .from("members")
    .select("id, wallet_address, display_name, handle, avatar_path, status, invited_by_member_id, needs_review_since, created_at")
    .order("created_at", { ascending: false })
    .returns<DbMember[]>();
  if (error) throw error;

  const { data: role, error: roleError } = await supabase
    .from("roles")
    .select("id")
    .eq("system_key", "sponsor")
    .maybeSingle<{ id: string }>();
  if (roleError) throw roleError;

  const { data: adminRole, error: adminRoleError } = await supabase
    .from("roles")
    .select("id")
    .eq("name", "SuperAdmin")
    .maybeSingle<{ id: string }>();
  if (adminRoleError) throw adminRoleError;

  let adminIds = new Set<string>();
  if (adminRole) {
    const { data: admins, error: adminsError } = await supabase
      .from("member_roles")
      .select("member_id")
      .eq("role_id", adminRole.id)
      .returns<{ member_id: string }[]>();
    if (adminsError) throw adminsError;
    adminIds = new Set((admins ?? []).map((h) => h.member_id));
  }

  let padrinoIds = new Set<string>();
  if (role) {
    const { data: holders, error: holdersError } = await supabase
      .from("member_roles")
      .select("member_id")
      .eq("role_id", role.id)
      .returns<{ member_id: string }[]>();
    if (holdersError) throw holdersError;
    padrinoIds = new Set((holders ?? []).map((h) => h.member_id));
  }

  const { data: verifiedRole, error: verifiedRoleError } = await supabase
    .from("roles")
    .select("id")
    .eq("system_key", "verified")
    .maybeSingle<{ id: string }>();
  if (verifiedRoleError) throw verifiedRoleError;

  let verifiedIds = new Set<string>();
  if (verifiedRole) {
    const { data: holders, error: holdersError } = await supabase
      .from("member_roles")
      .select("member_id")
      .eq("role_id", verifiedRole.id)
      .returns<{ member_id: string }[]>();
    if (holdersError) throw holdersError;
    verifiedIds = new Set((holders ?? []).map((h) => h.member_id));
  }

  const byId = new Map((members ?? []).map((m) => [m.id, m]));
  const rows: AdminMemberRow[] = (members ?? []).map((m) => {
    const sponsor = m.invited_by_member_id ? byId.get(m.invited_by_member_id) : undefined;
    return {
      ...toSummary(m),
      sponsor: sponsor ? toSummary(sponsor) : null,
      sponsorIsAdmin: sponsor ? adminIds.has(sponsor.id) : false,
      isPadrino: padrinoIds.has(m.id),
      isVerified: verifiedIds.has(m.id),
      needsReview: m.needs_review_since !== null,
      createdAt: m.created_at,
    };
  });

  return (
    <div className="flex flex-col gap-8">
      <header className="flex max-w-3xl flex-col gap-2">
        <h1 className="text-h1">Miembros</h1>
        <p className="text-fg-muted">
          Banea a quien rompa las normas y decide quién puede invitar. Al banear puedes penalizar también a quien le
          invitó.
        </p>
      </header>
      <MemberTable members={rows} meId={typeof me === "string" ? me : null} perms={perms} />
    </div>
  );
}

export default function AdminMembersPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <MembersContent />
    </Suspense>
  );
}
