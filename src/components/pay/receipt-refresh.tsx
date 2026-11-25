"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The first minute keeps the old pace (a fresh transaction confirms quickly). */
const FAST_TICKS = 12;
/** Then the wait doubles (10 s, 20 s, 40 s) up to once a minute. */
const MAX_DELAY_MS = 60_000;
/** A receipt left open stops after this long; «Check again» starts over. */
const GIVE_UP_AFTER_MS = 30 * 60_000;

type Props = {
  everyMs?: number;
  /** At most this many refreshes, then stop silently (the error retries). */
  maxTicks?: number;
  /** The «Check again» label: with it, giving up after 30 minutes offers the button. */
  checkAgainLabel?: string;
};

/**
 * Re-reads the receipt (a server refresh, so a function run each time) while it is not final: every `everyMs` for the
 * first minute, then less and less often, never while the tab is hidden (at once when it comes back), and not at all
 * after 30 minutes, when `checkAgainLabel` offers to start over.
 */
export function ReceiptRefresh({ everyMs = 5000, maxTicks, checkAgainLabel }: Props) {
  const router = useRouter();
  const [round, setRound] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (gaveUp) return;
    const startedAt = Date.now();
    let lastRefreshAt = startedAt;
    let ticks = 0;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const delayFor = (tick: number) => (tick < FAST_TICKS ? everyMs : Math.min(everyMs * 2 ** (tick - FAST_TICKS + 1), MAX_DELAY_MS));

    const expired = () => Date.now() - startedAt >= GIVE_UP_AFTER_MS;
    const giveUp = () => {
      done = true;
      if (checkAgainLabel) setGaveUp(true);
    };
    const tick = () => {
      if (expired()) return giveUp();
      if (document.visibilityState === "hidden") return schedule();
      ticks += 1;
      lastRefreshAt = Date.now();
      router.refresh();
      if (maxTicks !== undefined && ticks >= maxTicks) {
        done = true;
        return;
      }
      schedule();
    };
    const schedule = () => {
      if (expired()) return giveUp();
      timer = setTimeout(tick, delayFor(ticks));
    };
    // Back to the tab: at once if the current wait is over (the pending timer was resting), otherwise the timer stays,
    // so switching tabs back and forth costs no extra refresh.
    const onVisible = () => {
      if (done || document.visibilityState !== "visible" || timer === undefined) return;
      if (Date.now() - lastRefreshAt < delayFor(ticks)) return;
      clearTimeout(timer);
      tick();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, everyMs, maxTicks, checkAgainLabel, gaveUp, round]);

  if (!gaveUp || !checkAgainLabel) return null;
  return (
    <div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          router.refresh();
          setGaveUp(false);
          setRound((r) => r + 1);
        }}
      >
        <RotateCw aria-hidden />
        {checkAgainLabel}
      </Button>
    </div>
  );
}
