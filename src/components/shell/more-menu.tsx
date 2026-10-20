"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type MoreItem = { href: string; text: string; icon: React.ReactNode };

/**
 * «Más» tab of the desktop top bar: the staff-only sections live here so the bar keeps a fixed, short list of tabs
 * (it never has to squeeze or scroll). It looks like a tab and is active while one of its sections is open.
 */
export function MoreMenu({ items }: { items: MoreItem[] }) {
  const pathname = usePathname();
  const active = items.some(({ href }) => pathname === href || pathname.startsWith(`${href}/`));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex h-14 min-h-11 min-w-11 items-center justify-center gap-2 border-b-2 px-3 text-sm font-bold whitespace-nowrap transition-colors duration-150 ease-out outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset motion-reduce:transition-none",
          active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
        )}
      >
        <Ellipsis className="size-4" aria-hidden />
        <span className="sr-only xl:not-sr-only">Más</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={0}>
        {items.map(({ href, text, icon }) => (
          <DropdownMenuItem key={href} asChild>
            <Link href={href} aria-current={pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined}>
              {icon}
              {text}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
