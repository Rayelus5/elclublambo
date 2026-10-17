import { Suspense } from "react";
import { redirect } from "next/navigation";
import { NotificationsProvider } from "@/components/notifications/notifications-provider";
import { RightRail } from "@/components/shell/right-rail";
import { Sidebar } from "@/components/shell/sidebar";
import { getVisibleChannels, toRow } from "@/lib/channels/queries";
import { UnreadProvider } from "@/lib/chat/unread";
import { walletFromUser } from "@/lib/auth/wallet";
import { hasPerm, Perm } from "@/lib/permissions/bits";
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

  const [{ data: rawPerms }, channels, me, unreadCount] = await Promise.all([
    supabase.rpc("my_permissions"),
    getVisibleChannels(),
    supabase.rpc("current_member_id"),
    supabase.rpc("my_unread_notification_count"),
  ]);
  const perms = BigInt(String(rawPerms ?? 0));
  // The reports link also shows for MANAGE_MESSAGES granted only by a channel overwrite.
  const canModerate = hasPerm(perms, Perm.MANAGE_MESSAGES)
    ? true
    : (await supabase.rpc("has_any_channel_perm", { p_bit: 8 })).data === true;
  // The member id comes from the session on the server (it names the private realtime topic); never from the client.
  const memberId = typeof me.data === "string" ? me.data : null;
  if (!memberId) redirect("/no-access");
  const initialCount = typeof unreadCount.data === "number" ? unreadCount.data : 0;

  return (
    <NotificationsProvider memberId={memberId} initialCount={initialCount}>
    <UnreadProvider>
      <div className="grid min-h-dvh flex-1 grid-cols-1 grid-rows-[auto_1fr] md:grid-rows-none md:grid-cols-[264px_minmax(0,1fr)] lg:grid-cols-[264px_minmax(0,1fr)_320px]">
        <Sidebar perms={perms} wallet={wallet} channels={channels.map(toRow)} canModerate={canModerate} />
        <main className="min-w-0 px-4 py-8 sm:px-8 md:py-12">{children}</main>
        <RightRail />
      </div>
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
