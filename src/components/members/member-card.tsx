"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { MemberAvatar } from "@/components/members/member-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { shortAddress } from "@/lib/auth/wallet";
import { getMemberCard, type MemberCardData } from "@/lib/members/card";
import { parsePresenceEvent } from "@/lib/members/presence";
import { usePrivateTopic } from "@/lib/realtime/private-topic";
import { memberName } from "@/lib/members/name";
import { createBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

const JOINED = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" });

/** Green/grey dot plus text: online state is never conveyed by colour alone. */
export function PresenceDot({ online, className }: { online: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", online ? "bg-success" : "bg-fg-muted/50", className)} />
  );
}

type Load = { status: "loading" } | { status: "ready"; card: MemberCardData } | { status: "error" };

/** Mounted only while the card is open: its online line follows the presence topic live. */
function LivePresence({ memberId, initial }: { memberId: string; initial: boolean }) {
  const [online, setOnline] = useState(initial);
  usePrivateTopic("presence", "presence_changed", {
    onEvent: (payload) => {
      const ev = parsePresenceEvent(payload);
      if (ev && ev.memberId === memberId) setOnline(ev.online);
    },
  });
  return (
    <>
      <PresenceDot online={online} />
      {online ? "En línea" : "Desconectado"}
    </>
  );
}

function CardBody({ state }: { state: Load }) {
  if (state.status === "loading") return <p className="text-sm text-fg-muted">Cargando…</p>;
  if (state.status === "error") return <p className="text-sm text-fg-muted">No se pudo cargar este miembro.</p>;
  const c = state.card;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <MemberAvatar member={c} size={64} />
        <div className="flex min-w-0 flex-col">
          <p className="truncate font-display text-lg font-bold text-fg">{memberName(c)}</p>
          {c.handle && c.displayName ? <p className="truncate text-sm text-fg-muted">@{c.handle}</p> : null}
          <p className="font-mono text-[13px] text-fg-muted">{shortAddress(c.walletAddress)}</p>
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
        <LivePresence memberId={c.id} initial={c.online} />
        {c.status === "banned" ? (
          <span className="rounded-control border border-danger px-1.5 text-[13px] text-danger">Baneado</span>
        ) : null}
      </p>
      {c.roles.length > 0 ? (
        <ul aria-label="Roles" className="flex flex-wrap gap-1.5">
          {c.roles.map((r) => (
            <li key={r.name} className="inline-flex items-center gap-1.5 rounded-control border border-border px-2 py-0.5 text-[13px] text-fg">
              <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: r.color }} />
              {r.name}
            </li>
          ))}
        </ul>
      ) : null}
      {c.bio ? <p className="line-clamp-4 text-sm break-words whitespace-pre-line text-fg">{c.bio}</p> : null}
      {c.joinedAt ? <p className="text-[13px] text-fg-muted">Miembro desde {JOINED.format(new Date(c.joinedAt))}</p> : null}
      <Link
        href={`/u/${c.walletAddress}`}
        className="inline-flex min-h-11 items-center justify-center rounded-control bg-accent px-4 text-sm font-bold text-bg outline-none hover:bg-accent/85 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        Ver perfil completo
      </Link>
    </div>
  );
}

/**
 * Wraps a member's name or avatar in the chat (or the rail) so a click opens their card. The card is read when it
 * opens, through member_card (members only), and re-read on each open so the online state is fresh.
 */
export function MemberCardTrigger({
  memberId,
  label,
  children,
  className,
  tabbable = true,
}: {
  memberId: string;
  /** Accessible name of the member (the trigger reads "Ver tarjeta de …"). */
  label: string;
  children: ReactNode;
  className?: string;
  /** False for a duplicate trigger next to a tabbable one (the avatar beside the name): one keyboard stop per member. */
  tabbable?: boolean;
}) {
  const [state, setState] = useState<Load>({ status: "loading" });
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) return;
        setState({ status: "loading" });
        getMemberCard(createBrowserClient(), memberId)
          .then((card) => setState({ status: "ready", card }))
          .catch(() => setState({ status: "error" }));
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Ver tarjeta de ${label}`}
          tabIndex={tabbable ? undefined : -1}
          className={cn("cursor-pointer rounded-control text-left outline-none focus-visible:ring-2 focus-visible:ring-accent", className)}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent role="dialog" aria-label={label}>
        <CardBody state={state} />
      </PopoverContent>
    </Popover>
  );
}
