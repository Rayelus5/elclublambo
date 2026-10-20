import { Suspense } from "react";
import { PageLoader } from "@/components/shell/page-loader";
import { NotificationList } from "@/components/notifications/notification-list";
import { PushToggle } from "@/components/notifications/push-toggle";
import { listNotifications, PAGE_SIZE } from "@/lib/notifications/queries";
import { createServerClient } from "@/lib/supabase/server";

// Lee cookies (dinámico): con cacheComponents debe vivir dentro de un Suspense.
async function NotificationsContent() {
  const supabase = await createServerClient();
  const initial = await listNotifications({ filter: "all" }, supabase);
  return (
    <div className="flex w-full flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1">Notificaciones</h1>
        <p className="text-fg-muted">Menciones, respuestas, canales que sigues y avisos del club.</p>
        <PushToggle publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || undefined} />
      </header>
      <NotificationList initial={initial} initialHasMore={initial.length === PAGE_SIZE} />
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <NotificationsContent />
    </Suspense>
  );
}
