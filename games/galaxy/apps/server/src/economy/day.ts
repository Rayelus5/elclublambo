// The game day (GDD §11.3 bis): it ends at 00:00 in Madrid, computed with the zone explicitly, never the server's.
const MADRID = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });

/** YYYY-MM-DD of `now` in Europe/Madrid. */
export function madridDay(now: Date = new Date()): string {
  return MADRID.format(now);
}

/** The first instant after `now` when the Madrid day changes (the daily yield's reset, GDD §11.3 bis). */
export function nextMadridMidnight(now: Date = new Date()): Date {
  const today = madridDay(now);
  // Walk forward by hours until the day changes, then back by minutes to the first minute of the new day.
  let t = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  while (madridDay(t) === today) t = new Date(t.getTime() + 3_600_000);
  while (madridDay(new Date(t.getTime() - 60_000)) !== today) t = new Date(t.getTime() - 60_000);
  return t;
}
