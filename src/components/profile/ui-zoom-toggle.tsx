"use client";

import { useSyncExternalStore } from "react";
import { applyUiZoom, readUiZoom, UI_ZOOM_LEVELS, type UiZoom } from "@/lib/ui-zoom";
import { cn } from "@/lib/utils";

const CHANGE = "ecl-ui-zoom-change";

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Interface size (like the browser's zoom), saved on this device only. */
export function UiZoomToggle({ className }: { className?: string }) {
  const zoom = useSyncExternalStore(subscribe, readUiZoom, () => 1 as UiZoom);
  const choose = (next: UiZoom) => {
    applyUiZoom(next);
    window.dispatchEvent(new Event(CHANGE));
  };
  return (
    <div
      role="radiogroup"
      aria-label="Tamaño de la interfaz"
      className={cn("inline-flex flex-wrap gap-1 rounded-control border border-border-strong p-1", className)}
    >
      {UI_ZOOM_LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={zoom === level}
          onClick={() => choose(level)}
          className={cn(
            "inline-flex min-h-11 min-w-14 items-center justify-center rounded-control px-2 font-mono text-[13px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-accent",
            zoom === level ? "bg-accent text-bg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
          )}
        >
          {Math.round(level * 100)} %
        </button>
      ))}
    </div>
  );
}
