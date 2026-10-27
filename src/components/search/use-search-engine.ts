"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChannelRow } from "@/lib/channels/tree";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { PaletteAction } from "@/lib/search/actions-list";
import { fold } from "@/lib/search/highlight";
import { searchMembers, searchMessages, type MemberHit, type MessageHit } from "@/lib/search/queries";

const DEBOUNCE_MS = 200;
const MIN_REMOTE_CHARS = 2;
const RECENT_KEY = "club:recent-channels";
const RECENT_MAX = 5;

type Remote = { q: string; members: MemberHit[]; messages: MessageHit[]; failed: boolean };

export interface SearchEngine {
  q: string;
  shownActions: PaletteAction[];
  shownChannels: ChannelRow[];
  members: MemberHit[];
  messages: MessageHit[];
  loading: boolean;
  failed: boolean;
  remoteEnabled: boolean;
  /** Channel id → name, for the "#canal" line of message hits. */
  channelNames: ReadonlyMap<string, string>;
}

function readRecents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberChannel(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecents().filter((x) => x !== id)].slice(0, RECENT_MAX)));
  } catch {
    // private mode or blocked storage: recents are a convenience only
  }
}

/** Every whitespace-separated token must appear (accent and case insensitive) in the label or keywords. */
function matches(q: string, ...fields: Array<string | undefined>): boolean {
  const tokens = fold(q).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = fold(fields.filter(Boolean).join(" "));
  return tokens.every((t) => hay.includes(t));
}

/**
 * Search engine shared by the Cmd+K palette and the Inicio field: local filtering of actions and channels (recents on
 * an empty query) plus a debounced remote search of members and messages (RPCs under the user's RLS).
 */
export function useSearchEngine({
  query,
  channels,
  actions,
}: {
  query: string;
  channels: readonly ChannelRow[];
  actions: readonly PaletteAction[];
}): SearchEngine {
  const [remote, setRemote] = useState<Remote | null>(null);
  const q = query.trim();
  const remoteEnabled = Array.from(q).length >= MIN_REMOTE_CHARS;

  // Debounced remote search. Any change of `q` (or unmount) invalidates the request in flight: a slow response for
  // "arb" can never replace the results of "arbitrum".
  useEffect(() => {
    if (!remoteEnabled) return;
    let stale = false;
    const timer = setTimeout(() => {
      void (async () => {
        const supabase = createBrowserClient();
        const [members, messages] = await Promise.allSettled([searchMembers(supabase, q), searchMessages(supabase, q)]);
        if (stale) return;
        setRemote({
          q,
          members: members.status === "fulfilled" ? members.value : [],
          messages: messages.status === "fulfilled" ? messages.value : [],
          failed: members.status === "rejected" || messages.status === "rejected",
        });
      })();
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      stale = true;
    };
  }, [q, remoteEnabled]);

  const channelNames = useMemo(() => new Map(channels.map((c) => [c.id, c.name])), [channels]);

  const shownActions = useMemo(() => actions.filter((a) => matches(q, a.label, a.keywords)), [actions, q]);
  const shownChannels = useMemo(() => {
    const textOnly = channels.filter((c) => c.kind !== "category").toSorted((a, b) => a.position - b.position);
    if (q !== "") return textOnly.filter((c) => matches(q, c.name, c.topic ?? undefined)).slice(0, 8);
    const recents = readRecents();
    const recent = recents.flatMap((id) => textOnly.find((c) => c.id === id) ?? []);
    return (recent.length > 0 ? recent : textOnly).slice(0, RECENT_MAX);
  }, [channels, q]);

  const settled = remoteEnabled && remote?.q === q ? remote : null;
  const loading = remoteEnabled && settled === null;

  return {
    q,
    shownActions,
    shownChannels,
    members: settled?.members ?? [],
    messages: settled?.messages ?? [],
    loading,
    failed: settled?.failed ?? false,
    remoteEnabled,
    channelNames,
  };
}
