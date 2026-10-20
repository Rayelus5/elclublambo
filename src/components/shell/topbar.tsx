"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { SearchButton } from "@/components/search/search-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/** Barra superior y drawer de navegación para < 768px. `children` es el cuerpo del sidebar. */
export function Topbar({ children, badge }: { children: React.ReactNode; badge?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-bg px-4 md:hidden">
      <Link
        href="/"
        className="inline-flex min-h-11 items-center font-display text-xl font-black tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        El Club.
      </Link>
      <div className="flex items-center">
        {badge}
        <SearchButton />
        <NotificationBell />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="Abrir menú">
              <Menu aria-hidden />
            </Button>
          </DialogTrigger>
        <DialogContent
          showCloseButton
          className="top-0 left-0 h-dvh w-[280px] max-w-[85vw] translate-x-0 translate-y-0 flex flex-col gap-0 overflow-y-auto overscroll-contain rounded-none border-y-0 border-l-0 bg-bg p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] data-open:slide-in-from-left sm:max-w-[85vw]"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a, [data-close-drawer]")) setOpen(false);
          }}
        >
          <DialogTitle className="sr-only">Menú</DialogTitle>
          <DialogDescription className="sr-only">Navegación principal del foro</DialogDescription>
          {children}
        </DialogContent>
        </Dialog>
      </div>
    </header>
  );
}
