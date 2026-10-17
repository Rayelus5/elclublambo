"use client";

import { useSyncExternalStore } from "react";
import { Search } from "lucide-react";
import { useSearch } from "@/components/search/search-provider";
import { Button } from "@/components/ui/button";

const noop = () => () => {};
const isMac = () => /Mac|iPhone|iPad/i.test(navigator.platform);

/**
 * "Buscar" opens the Cmd+K palette. `nav` is the labelled row of the sidebar; `icon` the 44px button of the mobile
 * top bar.
 */
export function SearchButton({ variant = "icon" }: { variant?: "icon" | "nav" }) {
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
  return (
    <Button type="button" variant="ghost" size="icon" aria-label="Buscar" aria-keyshortcuts="Control+K Meta+K" onClick={open}>
      <Search aria-hidden />
    </Button>
  );
}
