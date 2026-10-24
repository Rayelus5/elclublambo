"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Command, CommandDialog, CommandInput } from "@/components/ui/command";
import type { ChannelRow } from "@/lib/channels/tree";
import type { PaletteAction } from "@/lib/search/actions-list";
import { SearchResults } from "@/components/search/search-results";
import { rememberChannel, useSearchEngine } from "@/components/search/use-search-engine";

function PaletteBody({
  channels,
  actions,
  onDone,
}: {
  channels: readonly ChannelRow[];
  actions: readonly PaletteAction[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const engine = useSearchEngine({ query, channels, actions });

  const go = (href: string, channelId?: string) => {
    if (channelId) rememberChannel(channelId);
    onDone();
    router.push(href);
  };

  return (
    <Command shouldFilter={false} loop label="Buscar" className="bg-surface">
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Busca canales, miembros y mensajes…"
        aria-label="Buscar"
        autoComplete="off"
        spellCheck={false}
        maxLength={100}
      />
      <SearchResults engine={engine} onSelect={go} />
    </Command>
  );
}

/**
 * Cmd+K palette: actions, channels (local), members and messages (RPCs under the user's RLS). Mounted by
 * SearchProvider; the body mounts only while open, so every opening starts from a clean query.
 */
export function CommandPalette({
  open,
  onOpenChange,
  channels,
  actions,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: readonly ChannelRow[];
  actions: readonly PaletteAction[];
  onCloseAutoFocus?: (e: Event) => void;
}) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Buscar"
      description="Busca acciones, canales, miembros y mensajes. Usa las flechas y Enter para elegir."
      contentProps={{ onCloseAutoFocus }}
    >
      <PaletteBody channels={channels} actions={actions} onDone={() => onOpenChange(false)} />
    </CommandDialog>
  );
}
