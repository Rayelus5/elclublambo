// The game day (GDD §11.3 bis): it ends at 00:00 in Madrid, computed with the zone explicitly, never the server's.
const MADRID = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });

/** YYYY-MM-DD of `now` in Europe/Madrid. */
export function madridDay(now: Date = new Date()): string {
  return MADRID.format(now);
}
