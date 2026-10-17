import { Suspense } from "react";
import { redirect } from "next/navigation";
import { RightRail } from "@/components/shell/right-rail";
import { Sidebar } from "@/components/shell/sidebar";
import { getVisibleChannels, toRow } from "@/lib/channels/queries";
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

  const [{ data: rawPerms }, channels] = await Promise.all([
    supabase.rpc("my_permissions"),
    getVisibleChannels(),
  ]);
  const perms = BigInt(String(rawPerms ?? 0));

  return (
    <UnreadProvider>
      <div className="grid min-h-dvh flex-1 grid-cols-1 grid-rows-[auto_1fr] md:grid-rows-none md:grid-cols-[264px_minmax(0,1fr)] lg:grid-cols-[264px_minmax(0,1fr)_320px]">
        <Sidebar perms={perms} wallet={wallet} channels={channels.map(toRow)} />
        <main className="min-w-0 px-4 py-8 sm:px-8 md:py-12">{children}</main>
        <RightRail />
      </div>
    </UnreadProvider>
  );
}

export default function ForumLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<div className="min-h-dvh" aria-hidden />}>
      <ForumShell>{children}</ForumShell>
    </Suspense>
  );
}
