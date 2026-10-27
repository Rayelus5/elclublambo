"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Command, CommandInput } from "@/components/ui/command";
import { SearchResults } from "@/components/search/search-results";
import { SearchShortcut } from "@/components/search/search-button";
import { useSearch } from "@/components/search/search-provider";
import { rememberChannel, useSearchEngine } from "@/components/search/use-search-engine";

/**
 * The Inicio search field: the Cmd+K palette's engine and results, in place. Focusing or typing unfolds the results
 * under the field (over the page, nothing below moves); Esc empties and folds, a click or the focus leaving folds, and
 * Enter picks the selected result as in the palette. Mod+K from here still opens the palette (`data-home-search`).
 */
export function HomeSearch() {
  const { channels, actions } = useSearch();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const engine = useSearchEngine({ query, channels, actions });

  // cmdk always marks its input as expanded; here the list is only on screen while unfolded.
  useLayoutEffect(() => {
    input.current?.setAttribute("aria-expanded", open ? "true" : "false");
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const fold = () => {
    setOpen(false);
    setQuery("");
  };

  const go = (href: string, channelId?: string) => {
    if (channelId) rememberChannel(channelId);
    fold();
    router.push(href);
  };

  return (
    <Command
      ref={root}
      shouldFilter={false}
      loop
      // cmdk's Ctrl+K/J/N/P item navigation would swallow the palette shortcut (it prevents the default).
      vimBindings={false}
      label="Buscar en ElClub."
      data-home-search=""
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      className="relative mx-auto h-auto w-full max-w-[720px] overflow-visible bg-transparent"
    >
      <div className="flex min-h-14 items-center gap-3 rounded-panel border border-border-strong bg-surface px-4 transition-colors duration-150 ease-out focus-within:border-accent focus-within:ring-1 focus-within:ring-accent hover:border-fg-muted motion-reduce:transition-none sm:min-h-16 sm:px-5">
        <Search aria-hidden className="size-5 shrink-0 text-fg-muted" />
        <CommandInput
          ref={input}
          value={query}
          onValueChange={(v) => {
            setQuery(v);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && (open || query !== "")) {
              e.preventDefault();
              fold();
            }
          }}
          placeholder="Busca canales, miembros y mensajes…"
          autoComplete="off"
          spellCheck={false}
          maxLength={100}
          className="min-h-13 min-w-0 flex-1 border-b-0 px-0 text-base focus-visible:ring-0 sm:min-h-15 sm:text-lg md:text-lg"
        />
        <SearchShortcut className="hidden shrink-0 rounded-control border border-border px-1.5 py-0.5 font-mono text-[13px] text-fg-muted sm:inline" />
      </div>
      {open ? (
        <div
          // Keeps the focus in the field: a click on a result must not blur it (which folds the panel) before it lands.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-panel border border-border bg-surface shadow-2xl shadow-bg"
        >
          <SearchResults engine={engine} onSelect={go} />
        </div>
      ) : null}
    </Command>
  );
}
