import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { PendingSendsSync } from "@/components/payments/pending-sends-sync";
import { EconomyProvider } from "@/components/payments/economy-provider";
import { NotificationsProvider } from "@/components/notifications/notifications-provider";
import { SearchProvider } from "@/components/search/search-provider";
import { OnboardingGuideFrame } from "@/components/onboarding/guide-frame";
import { PresenceHeartbeat } from "@/components/members/presence-heartbeat";
import { RightRail } from "@/components/shell/right-rail";
import { ShellGrid } from "@/components/shell/shell-grid";
import { Sidebar } from "@/components/shell/sidebar";
import { getLockedChannels, getVisibleChannels, toRow } from "@/lib/channels/queries";
import { getEconomyConfig } from "@/lib/economy/config";
import { buildActions } from "@/lib/search/actions-list";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import { UnreadProvider } from "@/lib/chat/unread";
import { walletFromUser } from "@/lib/auth/wallet";
import { reverifyMyPendingIntents } from "@/lib/payments/confirm";
import { settlePendingDonations } from "@/lib/treasury/settle";
import { createServerClient } from "@/lib/supabase/server";

// Lee cookies (dinámico): con cacheComponents debe vivir dentro de un Suspense.
async function ForumShell({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: status } = await supabase.rpc("my_membership_status");
  if (status === "banned") redirect("/banned");
  if (status !== "active") redirect("/no-access");

  const wallet = walletFromUser(user);
  if (!wallet) redirect("/login");

  // has_any_channel_perm(8): same rule as the reports page (a 404 otherwise), MANAGE_MESSAGES in at least one visible
  // channel. Admins get the channel bits through channel_permissions, so the RPC covers them too.
  const mePromise = supabase.rpc("current_member_id");
  const [{ data: rawPerms }, channels, lockedChannels, me, unreadCount, moderates, openTickets, ticketChannels, economy, welcome] = await Promise.all([
    supabase.rpc("my_permissions"),
    getVisibleChannels(),
    // Channels a DAO view-gate locks for this member: they stay in the sidebar with a lock (name/kind/parent only).
    getLockedChannels(),
    mePromise,
    supabase.rpc("my_unread_notification_count"),
    supabase.rpc("has_any_channel_perm", { p_bit: 8 }),
    // RLS only returns the tickets the member authored or supports: the number of open ones.
    supabase.from("tickets").select("id", { count: "exact", head: true }).eq("status", "open"),
    // "Abrir ticket en #canal" is offered only where the member can post (same SEND_MESSAGES check as the channel
    // page). getVisibleChannels is cached per request, so this chains on the same read, in parallel with the rest.
    getVisibleChannels().then(async (all) =>
      (
        await Promise.all(
          all
            .filter((c) => c.kind === "text" && c.ticketsEnabled)
            .map(async (c) => {
              const { data } = await supabase.rpc("my_channel_permissions", { p_channel: c.id });
              return hasPerm(BigInt(String(data ?? 0)), Perm.SEND_MESSAGES) ? { id: c.id, name: c.name } : null;
            }),
        )
      ).flatMap((c) => c ?? []),
    ),
    // Cached per request: the badge shows the active network to every member.
    getEconomyConfig(),
    // Onboarding gate: the member row holds the welcome state (RLS lets a member read their own row).
    mePromise.then(async ({ data: id }) =>
      typeof id === "string"
        ? (
            await supabase
              .from("members")
              .select("handle, welcome_completed_at")
              .eq("id", id)
              .maybeSingle<{ handle: string | null; welcome_completed_at: string | null }>()
          ).data
        : null,
    ),
  ]);
  const perms = BigInt(String(rawPerms ?? 0));
  const visibleRows = channels.map(toRow);
  const seen = new Set(visibleRows.map((c) => c.id));
  const sidebarRows = [...visibleRows, ...lockedChannels.filter((c) => !seen.has(c.id))];
  const canModerate = moderates.data === true;
  const openTicketCount = openTickets.error ? 0 : (openTickets.count ?? 0);
  // The member id comes from the session on the server (it names the private realtime topic); never from the client.
  const memberId = typeof me.data === "string" ? me.data : null;
  if (!memberId) redirect("/no-access");

  // Interrupted flow (tab closed after signing): re-verify this member's pending tips off the response path. The
  // member id is passed in because a Server Component cannot read request APIs inside after().
  after(() => reverifyMyPendingIntents(memberId));
  // Same for the member's own donations waiting for finality (at most 5 per request; errors are swallowed).
  after(() => settlePendingDonations(undefined, { memberId, limit: 5 }).catch((e) => console.error("[treasury] layout settle failed", e)));

  // First login: the welcome (with its mandatory @handle) comes first. The proxy enforces this on every page request
  // (layouts do not re-run on client navigations); this is the defence in depth. Fails closed: no readable row means
  // not completed. The guide is the one page allowed before the welcome, and it gets no shell, so it links nowhere.
  if (!welcome || welcome.welcome_completed_at === null) {
    const path = (await headers()).get("x-pathname") ?? "/";
    const base = path.split(/[?#]/)[0] ?? path;
    if (base === "/guia" || base.startsWith("/guia/")) return <OnboardingGuideFrame>{children}</OnboardingGuideFrame>;
    redirect("/bienvenida?next=" + encodeURIComponent(path));
  }
  const initialCount = typeof unreadCount.data === "number" ? unreadCount.data : 0;

  return (
    <EconomyProvider config={economy} wallet={wallet} memberId={memberId}>
    <PendingSendsSync memberId={memberId} />
    <PresenceHeartbeat />
    <NotificationsProvider memberId={memberId} initialCount={initialCount}>
    <UnreadProvider>
    <SearchProvider channels={channels.map(toRow)} actions={buildActions({ perms, canReports: canModerate, ticketChannels, wallet })}>
      <ShellGrid>
        <Sidebar perms={perms} wallet={wallet} channels={sidebarRows} canModerate={canModerate} openTickets={openTicketCount} chainId={economy.activeChainId} />
        <main className="min-w-0 px-4 py-8 sm:px-8 md:py-10">{children}</main>
        <RightRail />
      </ShellGrid>
    </SearchProvider>
    </UnreadProvider>
    </NotificationsProvider>
    </EconomyProvider>
  );
}

export default function ForumLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<div className="min-h-dvh" aria-hidden />}>
      <ForumShell>{children}</ForumShell>
    </Suspense>
  );
}
