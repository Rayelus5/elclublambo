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
  /** Controlled picker (the message menu's "Añadir reacción" opens it); uncontrolled when omitted. */
  pickerOpen?: boolean;
  onPickerOpenChange?: (open: boolean) => void;
}

const CHIP =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-control border px-2.5 text-sm outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none disabled:cursor-default";

/**
 * One chip. A chip added after mount scales in; when its count changes (mine or someone else's, up or down) the
 * emoji and count pop: they are re-keyed so the animation replays, while the button itself (and its focus) stays.
 */
function Chip({ reaction: r, isNew, canReact, onToggle }: { reaction: ReactionChip; isNew: boolean; canReact: boolean; onToggle: (emoji: string) => void }) {
  const [enter] = useState(isNew);
  const [seen, setSeen] = useState(r.count);
  const [bumps, setBumps] = useState(0);
  if (seen !== r.count) {
    setSeen(r.count);
    setBumps((b) => b + 1);
  }
  return (
    <button
      type="button"
      aria-pressed={r.reactedByMe}
      disabled={!canReact}
      onClick={() => onToggle(r.emoji)}
      className={cn(
        CHIP,
        enter && "animate-reaction-in",
        r.reactedByMe ? "border-accent bg-surface-2 text-accent" : "border-border bg-surface text-fg-muted enabled:hover:border-border-strong enabled:hover:text-fg",
      )}
    >
      <span key={bumps} data-reaction-count className={cn("inline-flex items-center gap-1.5", bumps > 0 && "animate-reaction-pop")}>
        <span>{r.emoji}</span>
        <span className="font-bold tabular-nums">{r.count}</span>
      </span>
    </button>
  );
}

/**
 * Reaction chips, Discord-style: the add chip only sits next to existing reactions; a message without any offers
 * "Añadir reacción" from its actions menu instead, which opens the same picker through `pickerOpen`.
 */
export function ReactionBar({ reactions, canReact, onToggle, pickerOpen, onPickerOpenChange }: Props) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = pickerOpen ?? ownOpen;
  const setOpen = (next: boolean) => (onPickerOpenChange ? onPickerOpenChange(next) : setOwnOpen(next));
  const wrap = useRef<HTMLDivElement>(null);
  // The reactions the message had when it appeared do not animate; ones added later pop in.
  const [initial] = useState(() => new Set(reactions.map((r) => r.emoji)));

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) (onPickerOpenChange ?? setOwnOpen)(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, onPickerOpenChange]);

  const showAdd = canReact && reactions.length > 0;
  if (reactions.length === 0 && !(canReact && open)) return null;

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
              <Chip reaction={r} isNew={!initial.has(r.emoji)} canReact={canReact} onToggle={onToggle} />
            </li>
          ))}
        </ul>
      ) : null}
      {showAdd ? (
        <button
          type="button"
          aria-label="Añadir reacción"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={cn(CHIP, "border-border text-fg-muted hover:border-border-strong hover:text-fg")}
        >
          <SmilePlus aria-hidden className="size-4" />
        </button>
      ) : null}
      {canReact && open ? (
        <div className={cn("z-20", reactions.length > 0 ? "absolute bottom-full left-0 mb-2" : "relative")}>
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
