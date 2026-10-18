"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelRightClose, PanelRightOpen, Pin, Target } from "lucide-react";
import { ActivityList } from "@/components/home/activity-list";
import { MemberAvatar } from "@/components/members/member-avatar";
import { MemberCardTrigger, PresenceDot } from "@/components/members/member-card";
import { useRail } from "@/components/shell/shell-grid";
import {
  getChannelOverview,
  getClubActivity,
  getHomePins,
  getOpenBounties,
  messageHref,
  type ActivityItem,
  type ChannelOverview,
  type HomeBounty,
  type HomePin,
} from "@/lib/home/queries";
import { getChannelMembers, type ChannelMember } from "@/lib/members/card";
import { memberName } from "@/lib/members/name";
import { formatAmount } from "@/lib/payments/amounts";
import { usePrivateTopic } from "@/lib/realtime/private-topic";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

const CHANNEL_PATH = /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;
const ROW =
  "flex min-h-11 items-start gap-2 rounded-control px-2 py-2 text-sm outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent";

function RailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-2 text-[13px] font-bold tracking-wide text-fg-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

type Load<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error" };

const MEMBERS_REFRESH_MS = 60_000;

function MemberRow({ m }: { m: ChannelMember }) {
  const name = memberName(m);
  return (
    <li>
      <MemberCardTrigger
        memberId={m.id}
        label={name}
        className={cn("flex min-h-11 w-full items-center gap-2 px-2 py-1 text-sm hover:bg-surface-2", !m.online && "opacity-60")}
      >
        <span className="relative shrink-0">
          <MemberAvatar member={m} size={24} />
          <PresenceDot online={m.online} className="absolute -right-0.5 -bottom-0.5 ring-2 ring-surface" />
        </span>
        <span className="min-w-0 flex-1 truncate text-fg">{name}</span>
        {m.roleColor ? <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: m.roleColor }} /> : null}
      </MemberCardTrigger>
    </li>
  );
}

/** Who can read the channel, online first (server-authoritative presence, refreshed every minute). */
function ChannelMembers({ channelId }: { channelId: string }) {
  const [state, setState] = useState<Load<ChannelMember[]>>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    const load = () =>
      getChannelMembers(createBrowserClient(), channelId)
        .then((data) => alive && setState({ status: "ready", data }))
        .catch(() => alive && setState((s) => (s.status === "ready" ? s : { status: "error" })));
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, MEMBERS_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [channelId]);

  if (state.status === "loading") return <p className="px-2 text-sm text-fg-muted">Cargando miembros…</p>;
  if (state.status === "error") return <p className="px-2 text-sm text-fg-muted">No se pudieron cargar los miembros.</p>;
  const online = state.data.filter((m) => m.online);
  const offline = state.data.filter((m) => !m.online);
  return (
    <div className="flex flex-col gap-4">
      <RailSection title={`En línea — ${online.length}`}>
        {online.length === 0 ? (
          <p className="px-2 text-sm text-fg-muted">Nadie conectado ahora.</p>
        ) : (
          <ul aria-label="Miembros en línea" className="flex flex-col">
            {online.map((m) => (
              <MemberRow key={m.id} m={m} />
            ))}
          </ul>
        )}
      </RailSection>
      {offline.length > 0 ? (
        <RailSection title={`Desconectados — ${offline.length}`}>
          <ul aria-label="Miembros desconectados" className="flex flex-col">
            {offline.map((m) => (
              <MemberRow key={m.id} m={m} />
            ))}
          </ul>
        </RailSection>
      ) : null}
    </div>
  );
}

/** Inside a channel: its topic, its pins and open bounties, and who can read it (online first). */
function ChannelRail({ channelId }: { channelId: string }) {
  const [state, setState] = useState<Load<{ overview: ChannelOverview; pins: HomePin[]; bounties: HomeBounty[] }>>({ status: "loading" });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    const supabase = createBrowserClient();
    Promise.all([getChannelOverview(supabase, channelId), getHomePins(supabase, 5, channelId), getOpenBounties(supabase, 5, channelId)])
      .then(([overview, pins, bounties]) => alive && setState({ status: "ready", data: { overview, pins, bounties } }))
      .catch(() => alive && setState({ status: "error" }));
    return () => {
      alive = false;
    };
  }, [channelId]);
  // Activity only re-reads the open bounties (the member count walks every member's permissions: once per visit).
  useEffect(() => {
    if (version === 0) return;
    let alive = true;
    getOpenBounties(createBrowserClient(), 5, channelId)
      .then((bounties) => alive && setState((s) => (s.status === "ready" ? { status: "ready", data: { ...s.data, bounties } } : s)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [channelId, version]);
  // A new bounty (or a tip/donation) anywhere refreshes the open-bounty list; pins refresh on the next visit.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const bump = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVersion((v) => v + 1), 300);
  };
  usePrivateTopic("activity", "activity_changed", { onEvent: bump, onResync: bump });

  if (state.status === "loading") return <p className="px-2 text-sm text-fg-muted">Cargando…</p>;
  if (state.status === "error") return <p className="px-2 text-sm text-fg-muted">No se pudo cargar el canal.</p>;
  const { overview, pins, bounties } = state.data;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 px-2">
        <p className="font-display text-lg font-bold break-words text-fg">#{overview.name}</p>
        {overview.topic ? <p className="text-sm break-words text-fg-muted">{overview.topic}</p> : null}
      </div>
      <RailSection title="Fijados">
        {pins.length === 0 ? (
          <p className="px-2 text-sm text-fg-muted">Nada fijado en este canal.</p>
        ) : (
          <ul aria-label="Fijados del canal" className="flex flex-col">
            {pins.map((p) => (
              <li key={p.messageId}>
                <Link href={messageHref(p.channelId, p.messageId)} className={ROW}>
                  <Pin aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                  <span className="line-clamp-2 min-w-0 flex-1 text-fg">{p.excerpt || "Mensaje fijado"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </RailSection>
      <RailSection title="Bounties abiertos">
        {bounties.length === 0 ? (
          <p className="px-2 text-sm text-fg-muted">Ninguno abierto aquí.</p>
        ) : (
          <ul aria-label="Bounties abiertos del canal" className="flex flex-col">
            {bounties.map((b) => (
              <li key={b.messageId}>
                <Link href={messageHref(b.channelId, b.messageId)} className={ROW}>
                  <Target aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate text-fg">{b.excerpt || "Bounty"}</span>
                  <span className="shrink-0 font-mono font-bold text-fg">
                    {formatAmount(b.amount, b.token)} {b.token}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </RailSection>
      <ChannelMembers channelId={channelId} />
    </div>
  );
}

/** Everywhere else: the club's live activity (tips, donations, new bounties), refreshed on the private activity topic. */
function ActivityRail() {
  const [state, setState] = useState<Load<ActivityItem[]>>({ status: "loading" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(() => {
    getClubActivity(createBrowserClient(), 15)
      .then((data) => setState({ status: "ready", data }))
      .catch(() => setState((s) => (s.status === "ready" ? s : { status: "error" })));
  }, []);
  useEffect(() => {
    load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(load, 300);
  };
  usePrivateTopic("activity", "activity_changed", { onEvent: schedule, onResync: schedule });

  return (
    <RailSection title="Actividad en vivo">
      {state.status === "loading" ? (
        <p className="px-2 text-sm text-fg-muted">Cargando…</p>
      ) : state.status === "error" ? (
        <p className="px-2 text-sm text-fg-muted">No se pudo cargar la actividad.</p>
      ) : (
        <ActivityList items={state.data} />
      )}
    </RailSection>
  );
}

/** Contextual right rail (desktop): the current channel inside /c/<id>, the club's live activity elsewhere. Foldable. */
export function RightRail() {
  const pathname = usePathname() ?? "/";
  const channelId = CHANNEL_PATH.exec(pathname)?.[1] ?? null;
  const { collapsed, setCollapsed } = useRail();
  // Hidden below lg: do not fetch or hold a realtime channel for a panel nobody sees.
  const desktop = useMediaQuery("(min-width: 1024px)");
  if (!desktop) return <aside aria-hidden className="hidden" />;

  if (collapsed) {
    return (
      <aside aria-label="Panel lateral" className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] border-l border-border bg-surface lg:flex lg:justify-center lg:pt-3">
        <button
          type="button"
          aria-label="Mostrar panel lateral"
          title="Mostrar panel lateral"
          onClick={() => setCollapsed(false)}
          className="flex size-11 items-center justify-center rounded-control text-fg-muted outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
        >
          <PanelRightOpen aria-hidden className="size-5" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Panel lateral"
      className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] flex-col gap-4 overflow-y-auto border-l border-border bg-surface p-4 lg:flex"
    >
      <div className="flex justify-end">
        <button
          type="button"
          aria-label="Ocultar panel lateral"
          title="Ocultar panel lateral"
          onClick={() => setCollapsed(true)}
          className="flex size-11 items-center justify-center rounded-control text-fg-muted outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
        >
          <PanelRightClose aria-hidden className="size-5" />
        </button>
      </div>
      {channelId ? <ChannelRail key={channelId} channelId={channelId} /> : <ActivityRail />}
    </aside>
  );
}
