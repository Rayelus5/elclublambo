"use client";

import { useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";

interface Props {
  /** Remaining seconds as reported by the server (never derived from the client clock). */
  seconds: number;
  /** Changes every time the server reports a new value, so the same number restarts the countdown. */
  resetKey: number;
  onElapsed?: () => void;
}

export function SlowmodeTimer({ seconds, resetKey, onElapsed }: Props) {
  const [prev, setPrev] = useState({ seconds, resetKey });
  const [remaining, setRemaining] = useState(Math.max(0, Math.ceil(seconds)));
  if (prev.seconds !== seconds || prev.resetKey !== resetKey) {
    setPrev({ seconds, resetKey });
    setRemaining(Math.max(0, Math.ceil(seconds)));
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

  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !active) elapsed.current?.();
    wasActive.current = active;
  }, [active]);

  // The live region stays mounted so screen readers announce the text when it appears and changes.
  return (
    <div aria-live="polite" aria-atomic="true" className="text-[13px] text-fg-muted">
      {active ? (
        <span className="inline-flex items-center gap-1.5">
          <Timer aria-hidden className="size-4" />
          <span>{`Puedes escribir de nuevo en ${remaining}s`}</span>
        </span>
      ) : null}
    </div>
  );
}
