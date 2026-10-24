"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Pin } from "lucide-react";
import { HomeSection, PinnedList } from "@/components/home/home-sections";
import { messageHref, type HomePin } from "@/lib/home/queries";

/** The newest pinned message, big; «Ver todos (N)» unfolds the others. Nothing at all when nothing is pinned. */
export function FeaturedPin({ pins, failed = false }: { pins: readonly HomePin[]; failed?: boolean }) {
  const [all, setAll] = useState(false);
  const listId = useId();
  if (failed) return <HomeSection id="home-pin" title="Anuncio fijado" failed />;
  if (pins.length === 0) return null;

  const [top, ...rest] = pins.toSorted((a, b) => Date.parse(b.pinnedAt) - Date.parse(a.pinnedAt));
  return (
    <HomeSection
      id="home-pin"
      title="Anuncio fijado"
      action={
        rest.length > 0 ? (
          <button
            type="button"
            aria-expanded={all}
            aria-controls={listId}
            onClick={() => setAll((v) => !v)}
            className="inline-flex min-h-11 items-center rounded-control px-2 text-sm font-bold text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
          >
            {all ? "Ver menos" : `Ver todos (${pins.length})`}
          </button>
        ) : null
      }
    >
      <Link
        href={messageHref(top!.channelId, top!.messageId)}
        className="flex min-h-11 flex-col gap-3 rounded-panel border border-border bg-surface p-5 text-fg no-underline outline-none transition-colors duration-150 ease-out hover:border-border-strong hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:transition-none sm:p-6"
      >
        <span className="flex items-center gap-2 font-mono text-small text-fg-muted">
          <Pin aria-hidden className="size-4 shrink-0" />
          <span className="truncate">
            #{top!.channelName}
            {top!.authorLabel ? ` · ${top!.authorLabel}` : ""}
          </span>
        </span>
        <span className="line-clamp-4 text-lg leading-snug font-semibold break-words sm:text-xl">{top!.excerpt || "Mensaje fijado"}</span>
      </Link>
      {rest.length > 0 ? (
        <div id={listId} hidden={!all}>
          <PinnedList pins={rest} />
        </div>
      ) : null}
    </HomeSection>
  );
}
