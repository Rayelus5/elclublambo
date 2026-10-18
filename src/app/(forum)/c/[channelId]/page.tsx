import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Folder, Hash, Lock, Ticket, Timer, Sparkles } from "lucide-react";
import { getLockedChannels, getLockState, getVisibleChannels, type ChannelDetail } from "@/lib/channels/queries";
import { lockChainName } from "@/lib/channels/lock";
import { LockPage } from "@/components/channels/lock-page";
import { PostGateNotice } from "@/components/chat/post-gate-notice";
import { formatSlowmode } from "@/lib/channels/tree";
import { ChatView } from "@/components/chat/chat-view";
import { OpenTicketDialog } from "@/components/tickets/open-ticket-dialog";
import { FollowMenu, type FollowLevel } from "@/components/notifications/follow-menu";
import { loadChatContext } from "@/lib/chat/context";
import { createServerClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Chip({ icon: Icon, children }: { icon: typeof Timer; children: React.ReactNode }) {
  return (
    <li className="inline-flex min-h-8 items-center gap-1.5 rounded-control border border-border px-2.5 text-[13px] font-medium text-fg-muted">
      <Icon className="size-3.5" aria-hidden />
      {children}
    </li>
  );
}

async function TextChannel({ channel, threadId, messageId, nonce }: { channel: ChannelDetail; threadId: string | null; messageId: string | null; nonce: string | null }) {
  const supabase = await createServerClient();
  const [{ anchor, ...context }, follow, lock] = await Promise.all([
    loadChatContext(channel.id, messageId),
    supabase.rpc("my_channel_follow", { p_channel: channel.id }),
    // Non-null with scope "post" when a DAO post-gate (not a role) is what keeps the member from writing here.
    getLockState(channel.id),
  ]);
  const postGate = lock && lock.scope === "post" && !context.viewer.canPost ? <PostGateNotice state={lock} chainName={lockChainName(lock)} /> : null;
  // A failed or unexpected read must not masquerade as "mentions": the menu shows an error state instead.
  const followLevel: FollowLevel | null =
    !follow.error && (follow.data === "all" || follow.data === "mute" || follow.data === "mentions") ? follow.data : null;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex max-w-3xl flex-col gap-3">
        <h1 className="text-h1">
          <span className="text-fg-muted" aria-hidden>
            #
          </span>{" "}
          {channel.name}
        </h1>
        {channel.topic ? <p className="text-fg-muted">{channel.topic}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <FollowMenu key={`follow-${channel.id}`} channelId={channel.id} level={followLevel} />
          {channel.ticketsEnabled && context.viewer.canPost ? (
            <OpenTicketDialog key={`tickets-${channel.id}`} channelId={channel.id} channelName={channel.name} />
          ) : null}
        </div>
        {channel.slowmodeSeconds > 0 || channel.ticketsEnabled || channel.alphaEnabled ? (
          <ul className="flex flex-wrap gap-2" aria-label="Ajustes del canal">
            {channel.slowmodeSeconds > 0 ? (
              <Chip icon={Timer}>Slowmode {formatSlowmode(channel.slowmodeSeconds)}</Chip>
            ) : null}
            {channel.ticketsEnabled ? <Chip icon={Ticket}>Tickets</Chip> : null}
            {channel.alphaEnabled ? <Chip icon={Sparkles}>Alpha</Chip> : null}
          </ul>
        ) : null}
      </header>
      {/* Contract with the search palette: `?m=<messageId>[&h=<nonce>]`. `h` is any short token ([A-Za-z0-9_-], 1-32); it
          only exists to change this key, so choosing the SAME message again remounts the view and re-highlights it. A new `?m=` (e.g. from the search palette, same channel) remounts the view so it loads that window. A reply
          anchor always opens its own thread, derived under RLS from the message (it wins over a stale `?thread=`). */}
      <ChatView
        key={`${channel.id}:${messageId ?? ""}:${nonce ?? ""}`}
        channel={{ id: channel.id, slowmodeSeconds: channel.slowmodeSeconds, alphaEnabled: channel.alphaEnabled }}
        initialThreadId={anchor?.threadRootId ?? threadId}
        initialAnchorId={anchor?.id ?? null}
        initialAnchorNonce={nonce}
        postGate={postGate}
        {...context}
      />
    </div>
  );
}

type ChildItem = { id: string; kind: ChannelDetail["kind"]; name: string; topic: string | null; locked?: boolean };

function ChildList({ channel, items }: { channel: ChannelDetail; items: ChildItem[] }) {
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-h1">{channel.name}</h1>
        {channel.topic ? <p className="text-fg-muted">{channel.topic}</p> : null}
      </header>
      {items.length === 0 ? (
        <p className="text-fg-muted">Aquí no hay nada que puedas ver todavía.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((child) => {
            const Icon = child.kind === "text" ? Hash : Folder;
            return (
              <li key={child.id}>
                <Link
                  href={`/c/${child.id}`}
                  className="flex h-full min-h-11 flex-col gap-1 rounded-panel border border-border bg-surface p-4 transition-colors duration-150 outline-none hover:border-border-strong hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:transition-none"
                >
                  <span className="flex items-center gap-2 font-display text-lg font-bold text-fg">
                    <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden />
                    <span className="min-w-0 truncate">{child.name}</span>
                    {child.locked ? (
                      <>
                        <Lock className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
                        <span className="sr-only">(bloqueado)</span>
                      </>
                    ) : null}
                  </span>
                  {child.topic ? <span className="text-sm text-fg-muted">{child.topic}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Lee cookies (dinámico): con cacheComponents debe vivir dentro de un Suspense.
async function ChannelContent({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<{ thread?: string | string[]; m?: string | string[]; h?: string | string[] }>;
}) {
  const { channelId } = await params;
  const { thread, m, h } = await searchParams;
  // A notification link opens this thread; anything that is not a uuid is ignored.
  const threadId = typeof thread === "string" && UUID.test(thread) ? thread : null;
  // `?m=<messageId>` jumps to a message (search results); anything that is not a uuid is ignored.
  const nonce = typeof h === "string" && /^[\w-]{1,32}$/.test(h) ? h : null;
  const messageId = typeof m === "string" && UUID.test(m) ? m : null;
  if (!UUID.test(channelId)) notFound();

  // La RLS de `channels` solo devuelve lo visible: lo oculto es indistinguible de lo inexistente.
  const all = await getVisibleChannels();
  const channel = all.find((c) => c.id === channelId);
  if (!channel) {
    // Unless a DAO view-gate is all that hides it: then the member gets the lock page (name, kind and requirement only).
    const lock = await getLockState(channelId.toLowerCase());
    if (lock && lock.scope === "view") return <LockPage state={lock} chainName={lockChainName(lock)} />;
    notFound();
  }

  if (channel.kind === "text") return <TextChannel channel={channel} threadId={threadId} messageId={messageId} nonce={nonce} />;
  const locked = (await getLockedChannels()).filter((c) => c.parentId === channel.id);
  const kids: ChildItem[] = [...all.filter((c) => c.parentId === channel.id), ...locked].toSorted((a, b) => a.position - b.position);
  return <ChildList channel={channel} items={kids} />;
}

export default function ChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<{ thread?: string | string[]; m?: string | string[]; h?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<div className="min-h-64" aria-hidden />}>
      <ChannelContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
