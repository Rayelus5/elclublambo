"use client";

import Link from "next/link";
import { m } from "motion/react";
import { rise, Stage } from "@/components/start/motion";
import { HomeSection } from "@/components/home/home-sections";
import type { HomeUnreadChannel } from "@/lib/home/queries";

const MAX = 6;

const newLabel = (n: number) => (n >= 99 ? "99+ nuevos" : n === 1 ? "1 nuevo" : `${n} nuevos`);

/** «Continúa donde lo dejaste»: the channels with messages from others since the member last read them, newest first. */
export function ContinueCards({ channels, failed = false }: { channels: readonly HomeUnreadChannel[]; failed?: boolean }) {
  return (
    <HomeSection id="home-continue" title="Continúa donde lo dejaste" failed={failed}>
      {channels.length === 0 ? (
        <p className="text-sm text-fg-muted">Estás al día.</p>
      ) : (
        <Stage as="ul" label="Canales con mensajes nuevos" gap={0.05} amount={0.15} className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
          {channels.slice(0, MAX).map((c) => (
            <m.li key={c.channelId} variants={rise} className="min-w-0">
              <Link
                href={`/c/${c.channelId}`}
                className="flex h-full min-h-11 flex-col gap-2 rounded-panel border border-border bg-surface p-4 text-fg no-underline outline-none transition-colors duration-150 ease-out hover:border-border-strong hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:transition-none"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-bold">#{c.channelName}</span>
                  <span className="shrink-0 font-mono text-small text-accent">{newLabel(c.unreadCount)}</span>
                </span>
                <span className="line-clamp-2 text-sm break-words text-fg">{c.lastExcerpt || "Mensaje sin texto"}</span>
                {c.lastAuthor ? <span className="mt-auto truncate text-small text-fg-muted">{c.lastAuthor}</span> : null}
              </Link>
            </m.li>
          ))}
        </Stage>
      )}
    </HomeSection>
  );
}
