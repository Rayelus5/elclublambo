import { Link } from 'react-router';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';

// An admin's preview of a season (the panel's «Temporadas», plan «temporadas como fichas», 2026-11-22): the season
// shop and the leaderboard as players will meet them. A band on top says whose preview it is and when that season
// opens (or that it is open, or when it ended), what the preview leaves out, and leads back to the panel. Only admins
// ever reach it: for players the address's parameter does nothing. And the days of a season in players' words, from
// its first to its last day of play (a season ends at the midnight that starts the day after).

const p = copy.season.preview;
const dayFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short' });
const dayYearFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', year: 'numeric' });

/** A day as Madrid reads it: 13 nov, or 13 nov 2026 with its year. */
export function seasonDay(iso: string, year = false): string {
  return (year ? dayYearFmt : dayFmt).format(new Date(iso));
}

/** A season's last day of play: it ends at the midnight that starts the next day. */
export function lastDayOf(endsAt: string): string {
  return new Date(Date.parse(endsAt) - 1).toISOString();
}

/** «Del 13 nov al 22 nov 2026». */
export function seasonSpan(startsAt: string, endsAt: string): string {
  return copy.social.span(seasonDay(startsAt), seasonDay(lastDayOf(endsAt), true));
}

/** What the band says: when the previewed season opens, that it is open now, or when it ended. */
export function previewText(name: string, startsAt: string, endsAt: string, now = Date.now()): string {
  if (now < Date.parse(startsAt)) return p.starts(name, seasonDay(startsAt, true));
  if (now >= Date.parse(endsAt)) return p.ended(name, seasonDay(lastDayOf(endsAt), true));
  return p.open(name);
}

/** The preview's band, with the way back to the panel's «Temporadas». */
export function PreviewBanner({ name, startsAt, endsAt, hint }: { name: string; startsAt: string; endsAt: string; hint: string }) {
  return (
    <section className="lip panel preview-band" role="note" aria-label={p.option}>
      <span className="preview-band-icon" aria-hidden="true">
        <Icon name="eye" />
      </span>
      <div className="preview-band-text">
        <b>{previewText(name, startsAt, endsAt)}</b>
        <span>{hint}</span>
      </div>
      <Link to="/admin/temporadas" className="lip pill small" data-sfx="back">
        <Icon name="back" />
        <span>{p.back}</span>
      </Link>
    </section>
  );
}
