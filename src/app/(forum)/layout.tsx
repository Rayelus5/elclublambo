import { Suspense } from "react";
import { redirect } from "next/navigation";
import { NotificationsProvider } from "@/components/notifications/notifications-provider";
import { SearchProvider } from "@/components/search/search-provider";
import { RightRail } from "@/components/shell/right-rail";
import { Sidebar } from "@/components/shell/sidebar";
import { getVisibleChannels, toRow } from "@/lib/channels/queries";
import { buildActions } from "@/lib/search/actions-list";
import { hasPerm, Perm } from "@/lib/permissions/bits";
import { UnreadProvider } from "@/lib/chat/unread";
import { walletFromUser } from "@/lib/auth/wallet";
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
  const [{ data: rawPerms }, channels, me, unreadCount, moderates, openTickets, ticketChannels] = await Promise.all([
    supabase.rpc("my_permissions"),
    getVisibleChannels(),
    supabase.rpc("current_member_id"),
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
  ]);
  const perms = BigInt(String(rawPerms ?? 0));
  const canModerate = moderates.data === true;
  const openTicketCount = openTickets.error ? 0 : (openTickets.count ?? 0);
  // The member id comes from the session on the server (it names the private realtime topic); never from the client.
  const memberId = typeof me.data === "string" ? me.data : null;
  if (!memberId) redirect("/no-access");
  const initialCount = typeof unreadCount.data === "number" ? unreadCount.data : 0;

  return (
    <NotificationsProvider memberId={memberId} initialCount={initialCount}>
    <UnreadProvider>
    <SearchProvider channels={channels.map(toRow)} actions={buildActions({ perms, canReports: canModerate, ticketChannels, wallet })}>
      <div className="grid min-h-dvh flex-1 grid-cols-1 grid-rows-[auto_1fr] md:grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[264px_minmax(0,1fr)] lg:grid-cols-[264px_minmax(0,1fr)_320px]">
        <Sidebar perms={perms} wallet={wallet} channels={channels.map(toRow)} canModerate={canModerate} openTickets={openTicketCount} />
        <main className="min-w-0 px-4 py-8 sm:px-8 md:py-10">{children}</main>
        <RightRail />
      </div>
    </SearchProvider>
    </UnreadProvider>
    </NotificationsProvider>
  );
}

export default function ForumLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<div className="min-h-dvh" aria-hidden />}>
      <ForumShell>{children}</ForumShell>
    </Suspense>
  );
}
