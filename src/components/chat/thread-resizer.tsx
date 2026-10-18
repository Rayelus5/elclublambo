"use client";

import { useRef } from "react";

const STEP = 32;

/**
 * The drag handle between the channel and the thread panel (the panel sits on the right, so moving left widens it).
 * A focusable vertical separator: arrows resize by 32px, Home/End jump to the limits.
 */
export function ThreadResizer({
  width,
  min,
  max,
  onChange,
}: {
  width: number;
  min: number;
  max: number;
  onChange: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number; pointer: number } | null>(null);
  const clamp = (w: number) => Math.round(Math.min(Math.max(w, min), max));

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Redimensionar hilo"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onKeyDown={(e) => {
        const next =
          e.key === "ArrowLeft" ? width + STEP : e.key === "ArrowRight" ? width - STEP : e.key === "Home" ? min : e.key === "End" ? max : null;
        if (next === null) return;
        e.preventDefault();
        onChange(clamp(next));
      }}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, width, pointer: e.pointerId };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.pointer !== e.pointerId) return;
        onChange(clamp(d.width + (d.x - e.clientX)));
      }}
      onPointerUp={(e) => {
        drag.current = null;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      className="group relative z-20 w-2 shrink-0 cursor-col-resize touch-none outline-none focus-visible:bg-accent/30"
    >
      <span aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border-strong transition-colors group-hover:bg-accent group-focus-visible:bg-accent" />
    </div>
  );
}
