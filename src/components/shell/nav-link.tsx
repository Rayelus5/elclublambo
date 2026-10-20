"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LinkPending } from "@/components/shell/link-pending";
import { cn } from "@/lib/utils";

type Props = {
  href: string;
  children: React.ReactNode;
  /** Accessible name when the visible content is not all of it (e.g. with a counter badge). */
  label?: string;
  /** Small counter shown at the end of the row. */
  badge?: string;
  /** `side`: full-width row of the mobile drawer. `top`: tab of the desktop top bar, text from 1280px (icon below). */
  variant?: "side" | "top";
};

const badgeClass =
  "inline-flex h-5 min-w-5 items-center justify-center rounded-control bg-accent px-1 font-mono text-[11px] font-bold text-bg";

export function NavLink({ href, children, label, badge, variant = "side" }: Props) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  if (variant === "top") {
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        aria-label={label}
        className={cn(
          "relative flex h-14 min-h-11 w-full min-w-11 items-center justify-center gap-2 border-b-2 px-3 text-sm font-bold whitespace-nowrap transition-colors duration-150 ease-out outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset motion-reduce:transition-none",
          active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
        )}
      >
        {children}
        {badge ? (
          <span aria-hidden className={cn(badgeClass, "shrink-0")}>
            {badge}
          </span>
        ) : null}
        {/* Out of the flow (the tab keeps its width) and in the strip above the label, so it never covers it. */}
        <LinkPending className="absolute top-1 right-0.5" />
      </Link>
    );
  }
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      className={cn(
        "flex min-h-11 items-center gap-3 border-l-2 px-4 text-sm font-bold transition-colors duration-150 ease-out outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
      )}
    >
      {children}
      <LinkPending />
      {badge ? (
        <>
          <span className="flex-1" />
          <span aria-hidden className={badgeClass}>
            {badge}
          </span>
        </>
      ) : null}
    </Link>
  );
}
