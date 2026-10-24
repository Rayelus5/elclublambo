"use client";

import { Fragment } from "react";
import { AtSign, BookOpen, ChartCandlestick, Dices, Flag, Folder, HandHeart, Hash, LifeBuoy, MessageSquare, Settings, Ticket, User, Users, type LucideIcon } from "lucide-react";
import { CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { shortAddress } from "@/lib/auth/wallet";
import { MemberAvatar } from "@/components/members/member-avatar";
import { memberName } from "@/lib/members/name";
import { messageHref, type ActionIcon } from "@/lib/search/actions-list";
import { highlight } from "@/lib/search/highlight";
import type { SearchEngine } from "@/components/search/use-search-engine";

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
  donate: HandHeart,
  giveaways: Dices,
  market: ChartCandlestick,
};

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

/**
 * Result groups (Acciones, Canales, Miembros, Mensajes) and status rows of a search engine. Must live inside a cmdk
 * `<Command shouldFilter={false}>`. `channelId` is passed when a channel was chosen, so the caller can remember it.
 */
export function SearchResults({
  engine,
  onSelect,
  className,
}: {
  engine: SearchEngine;
  onSelect: (href: string, channelId?: string) => void;
  className?: string;
}) {
  const { q, shownActions, shownChannels, members, messages, loading, failed, channelNames } = engine;
  const total = shownActions.length + shownChannels.length + members.length + messages.length;

  return (
    <CommandList className={className}>
      {shownActions.length > 0 ? (
        <CommandGroup heading="Acciones">
          {shownActions.map((a) => {
            const Icon = ICONS[a.icon];
            return (
              <CommandItem key={a.id} value={`action:${a.id}`} onSelect={() => onSelect(a.href)}>
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
            <CommandItem key={c.id} value={`channel:${c.id}`} onSelect={() => onSelect(`/c/${c.id}`, c.id)}>
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
            <CommandItem key={m.id} value={`member:${m.id}`} onSelect={() => onSelect(`/u/${m.walletAddress}`)}>
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
              onSelect={() => onSelect(messageHref(m, Date.now().toString(36)))}
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
      {failed ? (
        <p role="alert" className="px-4 py-3 text-sm text-danger">
          No se pudo buscar. Inténtalo de nuevo.
        </p>
      ) : null}
      {total === 0 && !loading && !failed ? (
        <p role="status" className="px-4 py-6 text-center text-sm text-fg-muted">
          Sin resultados para «{q}»
        </p>
      ) : null}
    </CommandList>
  );
}
