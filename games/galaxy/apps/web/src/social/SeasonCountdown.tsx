import { useEffect, useState } from 'react';
import { copy } from '../copy/es';

// The season's live countdown on the leaderboard (GDD §13.1, DESIGN_SYSTEM §8 undecies; 2026-11-21): days, hours and
// minutes while more than a day is left, then hours, minutes and seconds. It ticks each second but is not a live
// region: a screen reader reads it when it gets there, never every second.

const t = copy.social;

/** The time left until `endsAt` in words, ticking each second while it is on screen. */
export function SeasonCountdown({ endsAt, className }: { endsAt: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  const left = Math.max(0, Math.floor((Date.parse(endsAt) - now) / 1000));
  const over = left === 0;
  useEffect(() => {
    if (over) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [over]);
  const text = over ? t.seasonEnding : t.seasonLeft(Math.floor(left / 86_400), Math.floor((left % 86_400) / 3600), Math.floor((left % 3600) / 60), left % 60);
  return (
    <time dateTime={endsAt} className={className}>
      {text}
    </time>
  );
}
