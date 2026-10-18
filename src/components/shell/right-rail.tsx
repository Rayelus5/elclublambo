"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelRightClose, PanelRightOpen, Pin, Target, Users } from "lucide-react";
import { ActivityList } from "@/components/home/activity-list";
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
import { formatAmount } from "@/lib/payments/amounts";
import { usePrivateTopic } from "@/lib/realtime/private-topic";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useMediaQuery } from "@/lib/use-media-query";

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

/** Inside a channel: its topic, how many members can see it, its pins and open bounties. */
function ChannelRail({ channelId }: { channelId: string }) {
  const [state, setState] = useState<Load<{ overview: ChannelOverview; pins: HomePin[]; bounties: HomeBounty[] }>>({ status: "loading" });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    const supabase = createBrowserClient();
    Promise.all([getChannelOverview(supabase, channelId), getHomePins(supabase, 5, channelId), getOpenBounties(supabase, 5, channelId)])
      .then(([overview, pins, bounties]) => alive && setState({ status: "ready", data: { overview, pins, bounties } }))
      .catch(() => alive && setState((s) => (s.status === "ready" ? s : { status: "error" })));
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
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <Users aria-hidden className="size-4" />
          {overview.memberCount === 1 ? "1 miembro con acceso" : `${overview.memberCount} miembros con acceso`}
        </p>
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
