"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CommandPalette } from "@/components/search/command-palette";
import type { ChannelRow } from "@/lib/channels/tree";
import type { PaletteAction } from "@/lib/search/actions-list";

interface SearchContextValue {
  /** Opens the palette (the "Buscar" buttons). */
  open: () => void;
}

const SearchContext = createContext<SearchContextValue>({ open: () => {} });

export const useSearch = () => useContext(SearchContext);

/**
 * True while a composer suggestion popup (@ mentions, / commands) is on screen, or the event comes from an expanded
 * combobox: Mod+K must not steal the keyboard in the middle of a mention.
 */
function suggestionOpen(target: EventTarget | null): boolean {
  if (typeof document === "undefined") return false;
  if (document.querySelector("[data-suggestion-popup]")) return true;
  // Only comboboxes: an expanded disclosure (sidebar category, popover trigger) must not block the shortcut.
  return target instanceof Element && target.closest('[role="combobox"][aria-expanded="true"]') !== null;
}

/** Layout-level provider: global Mod+K shortcut + the palette itself. Data comes from what the forum layout loaded. */
export function SearchProvider({
  channels,
  actions,
  children,
}: {
  channels: readonly ChannelRow[];
  actions: readonly PaletteAction[];
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);

  const open = useCallback(() => {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setIsOpen(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // `code` covers non-Latin layouts where `key` is not "k".
      if ((e.key.toLowerCase() !== "k" && e.code !== "KeyK") || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.defaultPrevented || e.isComposing) return;
      if (isOpen) {
        // Already open: keep it open and stop the browser's own Ctrl+K (its search bar) from stealing the focus.
        e.preventDefault();
        return;
      }
      if (suggestionOpen(e.target)) return;
      e.preventDefault();
      open();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, open]);

  const value = useMemo(() => ({ open }), [open]);

  return (
    <SearchContext.Provider value={value}>
      {children}
      <CommandPalette
        open={isOpen}
        onOpenChange={setIsOpen}
        channels={channels}
        actions={actions}
        onCloseAutoFocus={(e) => {
          // Back to whatever had the focus before opening (a navigation may have unmounted it: then let Radix decide).
          const el = opener.current;
          opener.current = null;
          if (el?.isConnected) {
            e.preventDefault();
            el.focus();
          }
        }}
      />
    </SearchContext.Provider>
  );
}
