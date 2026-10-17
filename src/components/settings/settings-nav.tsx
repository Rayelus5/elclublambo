"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SettingsSection } from "@/lib/permissions/settings";
import { cn } from "@/lib/utils";

export function SettingsNav({ sections }: { sections: SettingsSection[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Ajustes" className="flex flex-wrap gap-1 border-b border-border md:flex-col md:border-b-0">
      {sections.map((s) => {
        const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center border-b-2 px-3 text-sm font-bold transition-colors duration-150 ease-out outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent motion-reduce:transition-none md:border-b-0 md:border-l-2",
              active ? "border-accent text-fg" : "border-transparent text-fg-muted",
            )}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
