import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Folder, Hash, Ticket, Timer, Sparkles } from "lucide-react";
import { getVisibleChannels, type ChannelDetail } from "@/lib/channels/queries";
import { formatSlowmode } from "@/lib/channels/tree";
import { ChatView } from "@/components/chat/chat-view";
import { loadChatContext } from "@/lib/chat/context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Chip({ icon: Icon, children }: { icon: typeof Timer; children: React.ReactNode }) {
  return (
    <li className="inline-flex min-h-8 items-center gap-1.5 rounded-control border border-border px-2.5 text-[13px] font-medium text-fg-muted">
      <Icon className="size-3.5" aria-hidden />
      {children}
    </li>
  );
}

async function TextChannel({ channel }: { channel: ChannelDetail }) {
  const context = await loadChatContext(channel.id);
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
      <ChatView key={channel.id} channel={{ id: channel.id, slowmodeSeconds: channel.slowmodeSeconds, alphaEnabled: channel.alphaEnabled }} {...context} />
    </div>
  );
}

function ChildList({ channel, items }: { channel: ChannelDetail; items: ChannelDetail[] }) {
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
async function ChannelContent({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  if (!UUID.test(channelId)) notFound();

  // La RLS de `channels` solo devuelve lo visible: lo oculto es indistinguible de lo inexistente.
  const all = await getVisibleChannels();
  const channel = all.find((c) => c.id === channelId);
  if (!channel) notFound();

  if (channel.kind === "text") return <TextChannel channel={channel} />;
  const kids = all.filter((c) => c.parentId === channel.id).toSorted((a, b) => a.position - b.position);
  return <ChildList channel={channel} items={kids} />;
}

export default function ChannelPage({ params }: { params: Promise<{ channelId: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-64" aria-hidden />}>
      <ChannelContent params={params} />
    </Suspense>
  );
}
