"use client";

import { useSyncExternalStore } from "react";
import { Search } from "lucide-react";
import { useSearch } from "@/components/search/search-provider";
import { Button } from "@/components/ui/button";

const noop = () => () => {};
const isMac = () => /Mac|iPhone|iPad/i.test(navigator.platform);

/** The shortcut hint, «⌘K» on Apple devices and «Ctrl K» elsewhere (the server and first paint say «Ctrl K»). */
export function SearchShortcut({ className }: { className?: string }) {
  const mac = useSyncExternalStore(noop, isMac, () => false);
  return (
    <kbd aria-hidden className={className}>
      {mac ? "⌘K" : "Ctrl K"}
    </kbd>
  );
}

/**
 * "Buscar" opens the Cmd+K palette. `nav` is the labelled row of the mobile drawer; `bar` the search field look-alike
 * of the desktop top bar (icon only below 1536px); `icon` the 44px button of the mobile top bar.
 */
export function SearchButton({ variant = "icon" }: { variant?: "icon" | "nav" | "bar" }) {
  const { open } = useSearch();

  if (variant === "nav") {
    return (
      <button
        type="button"
        onClick={open}
        data-close-drawer=""
        aria-keyshortcuts="Control+K Meta+K"
        className="flex min-h-11 w-full items-center gap-3 border-l-2 border-transparent px-4 text-left text-sm font-bold text-fg-muted transition-colors duration-150 ease-out outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:transition-none"
      >
        <Search className="size-4" aria-hidden />
        Buscar
        <span className="flex-1" />
        <SearchShortcut className="font-mono text-[13px] font-normal text-fg-muted" />
      </button>
    );
  }
  if (variant === "bar") {
    return (
      <button
        type="button"
        onClick={open}
        aria-label="Buscar"
        aria-keyshortcuts="Control+K Meta+K"
        className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-control text-sm text-fg-muted transition-colors duration-150 ease-out outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:transition-none 2xl:w-56 2xl:justify-start 2xl:border 2xl:border-border 2xl:bg-surface 2xl:px-3"
      >
        <Search className="size-4" aria-hidden />
        <span aria-hidden className="hidden 2xl:inline">
          Buscar
        </span>
        <span aria-hidden className="hidden flex-1 2xl:block" />
        <SearchShortcut className="hidden font-mono text-[13px] text-fg-muted 2xl:inline" />
      </button>
    );
  }
  return (
    <Button type="button" variant="ghost" size="icon" aria-label="Buscar" aria-keyshortcuts="Control+K Meta+K" onClick={open}>
      <Search aria-hidden />
    </Button>
  );
}
