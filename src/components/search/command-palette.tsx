"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AtSign, BookOpen, ChartCandlestick, Flag, Folder, Hash, Landmark, LifeBuoy, MessageSquare, Settings, Ticket, User, Users, type LucideIcon } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { ChannelRow } from "@/lib/channels/tree";
import { shortAddress } from "@/lib/auth/wallet";
import { MemberAvatar } from "@/components/members/member-avatar";
import { memberName } from "@/lib/members/name";
import { createBrowserClient } from "@/lib/supabase/browser";
import { messageHref, type ActionIcon, type PaletteAction } from "@/lib/search/actions-list";
import { fold, highlight } from "@/lib/search/highlight";
import { searchMembers, searchMessages, type MemberHit, type MessageHit } from "@/lib/search/queries";

const DEBOUNCE_MS = 200;
const MIN_REMOTE_CHARS = 2;
const RECENT_KEY = "club:recent-channels";
const RECENT_MAX = 5;

const ICONS: Record<ActionIcon, LucideIcon> = {
  invite: Ticket,
  settings: Settings,
  members: Users,
  mentions: AtSign,
  tickets: LifeBuoy,
  ticket: LifeBuoy,
  reports: Flag,
  profile: User,
  guide: BookOpen,
  dao: Landmark,
  market: ChartCandlestick,
};

type Remote = { q: string; members: MemberHit[]; messages: MessageHit[]; failed: boolean };

function readRecents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function rememberChannel(id: string) {
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

function Highlighted({ text, q }: { text: string; q: string }) {
  return (
    <>
      {highlight(text, q).map((s, i) =>
        s.match ? (
          <mark key={i} className="bg-transparent font-bold text-accent">
            {s.text}
          </mark>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("es", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

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
  const members = settled?.members ?? [];
  const messages = settled?.messages ?? [];
  const total = shownActions.length + shownChannels.length + members.length + messages.length;

  const go = (href: string) => {
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
      <CommandList>
        {shownActions.length > 0 ? (
          <CommandGroup heading="Acciones">
            {shownActions.map((a) => {
              const Icon = ICONS[a.icon];
              return (
                <CommandItem key={a.id} value={`action:${a.id}`} onSelect={() => go(a.href)}>
                  <Icon aria-hidden className="text-fg-muted" />
                  <span className="min-w-0 truncate">{a.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}
        {shownChannels.length > 0 ? (
          <CommandGroup heading="Canales">
            {shownChannels.map((c) => (
              <CommandItem
                key={c.id}
                value={`channel:${c.id}`}
                onSelect={() => {
                  rememberChannel(c.id);
                  go(`/c/${c.id}`);
                }}
              >
                {c.kind === "forum" ? (
                  <Folder aria-hidden className="text-fg-muted" />
                ) : (
                  <Hash aria-hidden className="text-fg-muted" />
                )}
                <span className="min-w-0 truncate">{c.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {members.length > 0 ? (
          <CommandGroup heading="Miembros">
            {members.map((m) => (
              <CommandItem key={m.id} value={`member:${m.id}`} onSelect={() => go(`/u/${m.walletAddress}`)}>
                <MemberAvatar member={m} size={24} />
                <span className="min-w-0 flex-1 truncate">{memberName(m)}</span>
                <span className="shrink-0 font-mono text-[13px] text-fg-muted">{shortAddress(m.walletAddress)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {messages.length > 0 ? (
          <CommandGroup heading="Mensajes">
            {messages.map((m) => (
              <CommandItem
                key={m.id}
                value={`message:${m.id}`}
                className="items-start"
                onSelect={() => go(messageHref(m, Date.now().toString(36)))}
              >
                <MessageSquare aria-hidden className="mt-0.5 text-fg-muted" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-mono text-[13px] text-fg-muted">
                    #{channelNames.get(m.channelId) ?? "canal"} · {m.authorName} · {formatDate(m.createdAt)}
                  </span>
                  <span className="line-clamp-2 break-words">
                    <Highlighted text={m.snippet} q={q} />
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {loading ? (
          <p role="status" className="px-4 py-3 text-sm text-fg-muted">
            Buscando…
          </p>
        ) : null}
        {settled?.failed ? (
          <p role="alert" className="px-4 py-3 text-sm text-danger">
            No se pudo buscar. Inténtalo de nuevo.
          </p>
        ) : null}
        {total === 0 && !loading && !settled?.failed ? (
          <p role="status" className="px-4 py-6 text-center text-sm text-fg-muted">
            Sin resultados para «{q}»
          </p>
        ) : null}
      </CommandList>
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
