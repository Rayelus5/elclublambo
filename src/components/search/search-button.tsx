"use client";

import { useSyncExternalStore } from "react";
import { Search } from "lucide-react";
import { useSearch } from "@/components/search/search-provider";
import { Button } from "@/components/ui/button";

const noop = () => () => {};
const isMac = () => /Mac|iPhone|iPad/i.test(navigator.platform);

/**
 * "Buscar" opens the Cmd+K palette. `nav` is the labelled row of the mobile drawer; `bar` the search field look-alike
 * of the desktop top bar (icon only below 1280px); `icon` the 44px button of the mobile top bar.
 */
export function SearchButton({ variant = "icon" }: { variant?: "icon" | "nav" | "bar" }) {
  const { open } = useSearch();
  const mac = useSyncExternalStore(noop, isMac, () => false);

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
        <kbd aria-hidden className="font-mono text-[13px] font-normal text-fg-muted">
          {mac ? "⌘K" : "Ctrl K"}
        </kbd>
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
        className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-control text-sm text-fg-muted transition-colors duration-150 ease-out outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:transition-none xl:w-56 xl:justify-start xl:border xl:border-border xl:bg-surface xl:px-3"
      >
        <Search className="size-4" aria-hidden />
        <span aria-hidden className="hidden xl:inline">
          Buscar
        </span>
        <span aria-hidden className="hidden flex-1 xl:block" />
        <kbd aria-hidden className="hidden font-mono text-[13px] text-fg-muted xl:inline">
          {mac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
    );
  }
  return (
    <Button type="button" variant="ghost" size="icon" aria-label="Buscar" aria-keyshortcuts="Control+K Meta+K" onClick={open}>
      <Search aria-hidden />
    </Button>
  );
}
