import {
  type AdminSeason,
  type AdminTournament,
  type Gift,
  type TournamentFee,
  type TournamentIssue,
  TOURNAMENT_MAX_DAYS,
  type TournamentMetric,
  type TournamentRecord,
  type TournamentState,
} from '@galaxy/shared';
import { copy } from '../../copy/es';
import { fmtNumber } from '../forms/format';

// What the tournaments' list, wizard and review panel share (plan «temporadas como fichas», part 5; GDD §13.3): the
// groups of the list, the season a tournament falls in, a new record and a copy of one, which step each problem
// belongs to and its words, and how fees, money, scores and places read.

export const t = copy.admin.tournaments;
const DAY = 86_400_000;

/** The banner's recommended size (the card's 8:3 strip; plan part 4). */
export const BANNER = { width: 1600, height: 600 } as const;

/** The list's groups, the ones that need an admin first. */
export const GROUPS: readonly TournamentState[] = ['running', 'review', 'scheduled', 'draft', 'finished', 'cancelled'];

export type Step = 'data' | 'dates' | 'metric' | 'entry' | 'prizes' | 'review';
export const STEPS: readonly Step[] = ['data', 'dates', 'metric', 'entry', 'prizes', 'review'];

const dayFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const whenFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const eurFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

/** «23 nov». */
export const shortDay = (iso: string) => dayFmt.format(new Date(iso));
/** «23 nov, 18:00» in the admin's own time. */
export const when = (iso: string) => whenFmt.format(new Date(iso));
/** «150,00 €». */
export const euros = (n: number) => eurFmt.format(n);

/** «3 días», «5 h», «12 min» until a moment (from `now`). */
export function until(iso: string, now: number): string {
  const ms = Date.parse(iso) - now;
  if (ms < 60_000) return t.soon;
  if (ms >= DAY) return t.inDays(Math.round(ms / DAY));
  if (ms >= 3_600_000) return t.inHours(Math.round(ms / 3_600_000));
  return t.inMinutes(Math.round(ms / 60_000));
}

/** An entry fee in words: «500 monedas». */
export function feeWords(fee: TournamentFee): string {
  return copy.gifts.amount[fee.currency](fee.amount);
}

/** A score as the ranking reads it, by its measure: «1.240 puntos», «capa 7», «32 partidas». */
export function scoreText(metric: TournamentMetric, n: number): string {
  switch (metric) {
    case 'points':
    case 'best_run':
    case 'season_points':
      return `${fmtNumber(n)} ${n === 1 ? 'punto' : 'puntos'}`;
    case 'kills':
      return `${fmtNumber(n)} ${n === 1 ? 'baja' : 'bajas'}`;
    case 'runs':
      return `${fmtNumber(n)} ${n === 1 ? 'partida' : 'partidas'}`;
    case 'depth':
      return `Capa ${fmtNumber(n)}`;
    case 'cores':
      return `${fmtNumber(n)} ${n === 1 ? 'Núcleo' : 'Núcleos'}`;
    case 'extractions':
      return `${fmtNumber(n)} ${n === 1 ? 'extracción' : 'extracciones'}`;
  }
}

/** The season a tournament starting at `startsAt` falls in: one not closed whose dates hold it, a scheduled one first. */
export function seasonFor(seasons: readonly AdminSeason[], startsAt: string): AdminSeason | null {
  const at = Date.parse(startsAt);
  if (Number.isNaN(at)) return null;
  const holding = seasons.filter((s) => s.state !== 'closed' && Date.parse(s.startsAt) <= at && at < Date.parse(s.endsAt));
  return holding.find((s) => s.state === 'scheduled') ?? holding[0] ?? null;
}

/** A tournament's address from its title: «Copa del Vacío» → «copa-del-vacio» (3 to 48 characters). */
export function slugFor(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  if (!slug) return '';
  return slug.length >= 3 ? slug : `torneo-${slug}`;
}

/** The slug made unique among `taken` with -2, -3… */
export function uniqueSlug(slug: string, taken: ReadonlySet<string>): string {
  if (!slug || !taken.has(slug)) return slug;
  const stem = slug.replace(/-\d+$/, '');
  for (let n = 2; ; n++) {
    const next = `${stem.slice(0, 44)}-${n}`;
    if (!taken.has(next)) return next;
  }
}

/** The next midnight in the admin's own time, `days` from today. */
export function localMidnight(days: number, from = new Date()): string {
  const d = new Date(from);
  d.setHours(24 * days, 0, 0, 0);
  return d.toISOString();
}

/** The next Monday at 00:00 in the admin's own time (today's, if today is Monday and it has not started). */
export function nextMonday(from = new Date()): string {
  const d = new Date(from);
  const add = (8 - d.getDay()) % 7 || 7;
  return localMidnight(add, d);
}

/** A record with every field, as the wizard edits it. */
export function freshRecord(seasons: readonly AdminSeason[], now = new Date()): TournamentRecord {
  const startsAt = localMidnight(1, now);
  const endsAt = new Date(Date.parse(startsAt) + 7 * DAY).toISOString();
  return {
    slug: '',
    seasonId: seasonFor(seasons, startsAt)?.id ?? '',
    title: '',
    summary: '',
    rules: '',
    bannerMedia: null,
    detailsMedia: null,
    startsAt,
    endsAt,
    exclusive: true,
    metric: 'points',
    filters: { sector: null, probe: null, mode: 'any', minLevel: null },
    entry: null,
    prizes: [],
    participation: null,
    reviewHours: 24,
    maxEntrants: null,
  };
}

/**
 * A copy of a tournament for the next one: «(copia)» after its title, a free address, and the same length starting
 * where it ends (or tomorrow, at its hour, when it ended already).
 */
export function copyRecord(source: TournamentRecord, taken: ReadonlySet<string>, seasons: readonly AdminSeason[], now = new Date()): TournamentRecord {
  const length = Math.min(TOURNAMENT_MAX_DAYS * DAY, Math.max(3_600_000, Date.parse(source.endsAt) - Date.parse(source.startsAt)));
  let start = Date.parse(source.endsAt);
  if (start <= now.getTime()) {
    const at = new Date(source.startsAt);
    const next = new Date(now);
    next.setDate(next.getDate() + 1);
    next.setHours(at.getHours(), at.getMinutes(), 0, 0);
    start = next.getTime();
  }
  const startsAt = new Date(start).toISOString();
  return {
    ...structuredClone(source),
    title: t.copyOf(source.title).slice(0, 60),
    slug: uniqueSlug(source.slug, taken),
    startsAt,
    endsAt: new Date(start + length).toISOString(),
    seasonId: seasonFor(seasons, startsAt)?.id ?? source.seasonId,
  };
}

/** Which step of the wizard a problem belongs to (by its path). */
export function stepOf(issue: Pick<TournamentIssue, 'path'>): Step {
  const top = issue.path.split('.')[0] ?? '';
  if (['title', 'slug', 'summary', 'rules', 'bannerMedia', 'detailsMedia'].includes(top)) return 'data';
  if (['startsAt', 'endsAt', 'seasonId'].includes(top)) return 'dates';
  if (top === 'metric' || issue.path === 'filters.sector' || issue.path === 'filters.probe' || issue.path === 'filters.mode') return 'metric';
  if (['exclusive', 'entry', 'maxEntrants', 'filters'].includes(top)) return 'entry';
  if (['prizes', 'participation', 'reviewHours'].includes(top)) return 'prizes';
  return 'review';
}

/** A problem in words: its own text when it has one, else the field's. */
export function issueText(issue: TournamentIssue): string {
  const own = (copy.tournamentIssues as Record<string, string>)[issue.message];
  if (own) return own;
  const top = issue.path.split('.')[0] ?? '';
  return t.fieldIssues[top] ?? t.fieldIssue;
}

/** Problems that still let a draft be saved but not scheduled (its season still a draft, its end gone by). */
const SCHEDULE_ONLY = new Set(['tournament_season_closed', 'tournament_end_past']);
export const blocksSave = (i: TournamentIssue) => !SCHEDULE_ONLY.has(i.message);

/** Where a tournament goes on the list. */
export const groupOf = (x: Pick<AdminTournament, 'state'>): TournamentState => x.state;

/** Who has an entry in it at all (in, left or disqualified): taking a scheduled one back needs none. */
export const anyEntries = (x: Pick<AdminTournament, 'entrants' | 'left' | 'disqualified'>) => x.entrants + x.left + x.disqualified > 0;

/** A prize range's gifts, with a pack's own added to them (a record holds gifts, never packs), up to `max`. */
export function addGifts(list: readonly Gift[], more: readonly Gift[], max = 20): Gift[] {
  return [...list, ...more].slice(0, Math.max(list.length, max));
}
