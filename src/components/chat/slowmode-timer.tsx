"use client";

import { useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";

/** <60 s "Ns", <1 h "m:ss", <1 day "h:mm:ss", otherwise "Xd h:mm". */
export function formatDuration(totalSeconds: number): string {
  const t = Math.max(0, Math.ceil(totalSeconds));
  if (t < 60) return `${t}s`;
  const pad = (n: number) => String(n).padStart(2, "0");
  const s = t % 60;
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600) % 24;
  const d = Math.floor(t / 86400);
  if (t < 3600) return `${Math.floor(t / 60)}:${pad(s)}`;
  if (t < 86400) return `${h}:${pad(m)}:${pad(s)}`;
  return `${d}d ${h}:${pad(m)}`;
}

interface Props {
  /** Remaining seconds as reported by the server (never derived from the client clock). */
  seconds: number;
  /** Changes every time the server reports a new value, so the same number restarts the countdown. */
  resetKey: number;
  onElapsed?: () => void;
}

export function SlowmodeTimer({ seconds, resetKey, onElapsed }: Props) {
  const [prev, setPrev] = useState({ seconds, resetKey });
  const initial = Math.max(0, Math.ceil(seconds));
  const [remaining, setRemaining] = useState(initial);
  // Screen readers hear only the start and the end of the cooldown, never the per-second ticks.
  const [announcement, setAnnouncement] = useState(initial > 0 ? `Podrás escribir de nuevo en ${formatDuration(initial)}` : "");
  if (prev.seconds !== seconds || prev.resetKey !== resetKey) {
    setPrev({ seconds, resetKey });
    setRemaining(initial);
    if (initial > 0) setAnnouncement(`Podrás escribir de nuevo en ${formatDuration(initial)}`);
  }

  const elapsed = useRef(onElapsed);
  useEffect(() => {
    elapsed.current = onElapsed;
  });

  const active = remaining > 0;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setRemaining((r) => Math.max(0, r - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [active, prev.seconds, prev.resetKey]);

  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) {
      setAnnouncement("Ya puedes escribir");
      elapsed.current?.();
    }
    wasActive.current = active;
  }, [active]);

  return (
    <div className="text-[13px] text-fg-muted">
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
      {active ? (
        <span aria-hidden="true" className="inline-flex items-center gap-1.5">
          <Timer className="size-4" />
          <span>{`Puedes escribir de nuevo en ${formatDuration(remaining)}`}</span>
        </span>
      ) : null}
    </div>
  );
}
