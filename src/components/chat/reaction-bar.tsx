"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { SmilePlus } from "lucide-react";
import type { ReactionChip } from "@/lib/chat/model";
import { cn } from "@/lib/utils";

// The grid is only downloaded the first time someone opens it.
const EmojiPicker = lazy(() => import("@/components/chat/emoji-picker"));

interface Props {
  reactions: readonly ReactionChip[];
  /** ADD_REACTIONS: without it chips are read-only and there is no add button. */
  canReact: boolean;
  onToggle: (emoji: string) => void;
}

const CHIP =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-control border px-2.5 text-sm outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none disabled:cursor-default";

export function ReactionBar({ reactions, canReact, onToggle }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  if (reactions.length === 0 && !canReact) return null;

  const close = () => {
    setOpen(false);
    wrap.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.focus();
  };

  return (
    <div
      ref={wrap}
      className="relative flex flex-wrap items-center gap-1.5"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      {reactions.length > 0 ? (
        <ul aria-label="Reacciones" className="contents">
          {reactions.map((r) => (
            <li key={r.emoji} className="contents">
              <button
                type="button"
                aria-pressed={r.reactedByMe}
                disabled={!canReact}
                onClick={() => onToggle(r.emoji)}
                className={cn(
                  CHIP,
                  r.reactedByMe
                    ? "border-accent bg-surface-2 text-accent"
                    : "border-border bg-surface text-fg-muted enabled:hover:border-border-strong enabled:hover:text-fg",
                )}
              >
                <span>{r.emoji}</span>
                <span className="font-bold tabular-nums">{r.count}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {canReact ? (
        <button
          type="button"
          aria-label="Añadir reacción"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={cn(CHIP, "border-border text-fg-muted hover:border-border-strong hover:text-fg")}
        >
          <SmilePlus aria-hidden className="size-4" />
        </button>
      ) : null}
      {open ? (
        <div className="absolute bottom-full left-0 z-20 mb-2">
          <Suspense
            fallback={<div className="w-72 rounded-panel border border-border-strong bg-surface p-4 text-sm text-fg-muted">Cargando…</div>}
          >
            <EmojiPicker
              onPick={(emoji) => {
                onToggle(emoji);
                close();
              }}
            />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
