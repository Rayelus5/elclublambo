"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Smile } from "lucide-react";
import { Button } from "@/components/ui/button";

// The grid is only downloaded the first time someone opens it.
const EmojiPicker = lazy(() => import("@/components/chat/emoji-picker"));

export function EmojiButton({ editor, disabled }: { editor: Editor | null; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Closing the panel from inside returns focus to the trigger so keyboard users keep their place.
  const close = () => {
    setOpen(false);
    wrap.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  return (
    <div
      ref={wrap}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Insertar emoji"
        aria-expanded={open}
        aria-haspopup="true"
        disabled={disabled || !editor}
        onClick={() => setOpen((o) => !o)}
      >
        <Smile aria-hidden />
      </Button>
      {open ? (
        <div className="absolute bottom-full left-0 z-20 mb-2">
          <Suspense
            fallback={<div className="w-72 rounded-panel border border-border-strong bg-surface p-4 text-sm text-fg-muted">Cargando…</div>}
          >
            <EmojiPicker
              onPick={(emoji) => {
                // Inserting focuses the editor, which is where typing continues.
                editor?.chain().focus().insertContent(emoji).run();
                setOpen(false);
              }}
            />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
