"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type Props = { href: string; children: React.ReactNode };

export function NavLink({ href, children }: Props) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 border-l-2 px-4 text-sm font-bold transition-colors duration-150 ease-out outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
      )}
    >
      {children}
    </Link>
  );
}
