"use client";

import { clubPath } from "@/lib/club/paths";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { useNotifications } from "@/components/notifications/notifications-provider";
import { cn } from "@/lib/utils";

/**
 * Bell with the unread counter. `icon` is the 44px button of the mobile top bar; `nav` is the labelled row of the
 * sidebar. Renders nothing special without a provider (count 0).
 */
export function NotificationBell({ variant = "icon" }: { variant?: "icon" | "nav" }) {
  const { count } = useNotifications();
  const pathname = usePathname();
  const active = pathname === clubPath("/notifications");
  const label = count > 0 ? `Notificaciones, ${count} sin leer` : "Notificaciones";
  const badge =
    count > 0 ? (
      <span
        data-testid="notification-badge"
        aria-hidden
        className="inline-flex h-5 min-w-5 items-center justify-center rounded-control bg-accent px-1 font-mono text-[11px] font-bold text-bg"
      >
        {count > 9 ? "9+" : count}
      </span>
    ) : null;

  if (variant === "nav") {
    return (
      <Link
        href={clubPath("/notifications")}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-3 border-l-2 px-4 text-sm font-bold transition-colors duration-150 ease-out outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:transition-none",
          active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
        )}
      >
        <Bell className="size-4" aria-hidden />
        <span className="flex-1">Notificaciones</span>
        {badge}
      </Link>
    );
  }
  return (
    <Link
      href={clubPath("/notifications")}
      aria-label={label}
      className="relative inline-flex size-11 items-center justify-center rounded-control text-fg outline-none transition-colors duration-150 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:transition-none"
    >
      <Bell className="size-5" aria-hidden />
      {badge ? <span className="absolute top-1 right-0.5">{badge}</span> : null}
    </Link>
  );
}
