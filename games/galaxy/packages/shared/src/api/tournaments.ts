import { z } from 'zod';
import { usernameSchema } from '../account';
import type { Gift } from '../gifts/schema';
import type { CheckRow } from '../runs/replay-check';
import type {
  Participation,
  PrizeRange,
  TournamentBigReason,
  TournamentFee,
  TournamentFilters,
  TournamentIssue,
  TournamentMetric,
  TournamentRecord,
  TournamentRewards,
  TournamentState,
} from '../tournaments/record';

// The tournaments' API (plan «temporadas como fichas», part 5; GDD §13.3). Players list them, open one (its ranking,
// their row and their runs that count), sign up, leave and collect their prizes; admins prepare them, schedule them, and
// run the review that comes before any prize: the server replays the solo runs of the prize places, and an admin
// decides on what cannot be checked, disqualifies and publishes. Every write carries an `Idempotency-Key` header
// (players) or the admin's reason and password; refusals are API codes (`{ error }`, text in the web's es.ts).

// ---------------------------------------------------------------------------------------------------------------------
// Players

/** Why a player cannot sign up right now (null: they can). */
export type TournamentJoinBlock =
  /** Already in it. */
  | 'joined'
  /** Left it once: no way back [U]. */
  | 'left'
  | 'disqualified'
  /** Sign-up is over (it ended, or it is not open). */
  | 'closed'
  | 'full'
  | 'level'
  /** In another exclusive tournament whose dates overlap (`exclusiveWith`). */
  | 'exclusive';

/** The player's own place in a tournament. */
export interface TournamentMe {
  status: 'joined' | 'left' | 'disqualified';
  joinedAt: string;
  /** Live while it runs or is reviewed, final once finished; null without a score. */
  rank: number | null;
  score: number;
  /** Their runs that count (the window and filters of the tournament). */
  runs: number;
  /** Their account can win prizes (off: they keep their rank with a mark, the prize goes to the next one). */
  eligible: boolean;
  /** Finished: what they took (null: nothing). */
  rewards: TournamentRewards | null;
  /** Finished: their prizes were collected. */
  claimed: boolean;
  /** Cancelled: their fee came back. */
  refunded: boolean;
  /** Disqualified: why (as the admin wrote it). */
  reason: string | null;
}

/** A tournament as a card of the list. */
export interface TournamentCard {
  id: string;
  slug: string;
  title: string;
  summary: string;
  seasonId: string;
  state: Exclude<TournamentState, 'draft'>;
  startsAt: string;
  endsAt: string;
  /** In review: when the results come at the earliest; finished: when they were published; otherwise null. */
  resultsAt: string | null;
  /** The banner's URL (`/galaxy/api/media/<id>`), or null. */
  banner: string | null;
  exclusive: boolean;
  metric: TournamentMetric;
  filters: TournamentFilters;
  entry: TournamentFee | null;
  prizes: PrizeRange[];
  participation: Participation | null;
  /** Who is in it (left and disqualified players do not count). */
  entrants: number;
  maxEntrants: number | null;
  me: TournamentMe | null;
  /** Whether the viewer can sign up now, and why not. */
  join: { open: boolean; block: TournamentJoinBlock | null };
  /** The exclusive tournament the viewer is in that keeps them out of this one. */
  exclusiveWith: { slug: string; title: string } | null;
}

/** GET /galaxy/api/tournaments: the three tabs (En curso, Próximos, Terminados: in review, finished or cancelled). */
export interface TournamentList {
  running: TournamentCard[];
  upcoming: TournamentCard[];
  finished: TournamentCard[];
  now: string;
}

/** A row of a tournament's ranking. */
export interface TournamentRankRow {
  rank: number;
  username: string;
  avatar: string | null;
  frame: string | null;
  score: number;
  /** Off: the account ranks with a mark and wins no prize (its place's prize goes to the next one). */
  eligible: boolean;
  /** Its prize place among those who can win (null: none). */
  place: number | null;
  /** The viewer's own row. */
  me: boolean;
}

/** One of the viewer's runs that count. */
export interface TournamentRunRow {
  id: string;
  finishedAt: string;
  sector: string;
  probe: string;
  coop: boolean;
  outcome: 'extracted' | 'died' | 'abandoned';
  depth: number;
  kills: number;
  cores: number;
  /** The run's season points (the season's formula). */
  points: number;
  /** What it adds to the tournament's measure (for best_run and depth, the run's own figure: the best one counts). */
  value: number;
}

/** GET /galaxy/api/tournaments/:slug: the card, its rules and images, the ranking and the viewer's runs. */
export interface TournamentDetail extends TournamentCard {
  rules: string;
  /** The prize picture's URL, or null. */
  details: string | null;
  reviewHours: number;
  /** The first places (the podium is the first three). */
  ranking: TournamentRankRow[];
  /** How many have a score. */
  total: number;
  /** The viewer's row, also when it is not among the first. */
  mine: TournamentRankRow | null;
  /** The viewer's runs that count, newest first (the last 50). */
  myRuns: TournamentRunRow[];
  /** In review: how many runs are being checked, and how many are still waiting. */
  review: { checks: number; pending: number } | null;
}

/** POST /galaxy/api/tournaments/:id/join and /leave: the viewer's place now and their wallet. */
export interface TournamentEntryResult {
  me: TournamentMe;
  wallet: { coins: number; dust: number; signal: number };
}

/** POST /galaxy/api/tournaments/:id/claim: what each gift gave. */
export interface TournamentClaimResult {
  items: { gift: Gift; outcome: 'granted' | 'owned' | 'skipped'; galaxies?: { id: string; name: string; tier: number; finish: string }[]; why?: string }[];
  wallet: { coins: number; dust: number; signal: number };
}

export const tournamentIdParamsSchema = z.object({ id: z.uuid() }).strict();
export const tournamentSlugParamsSchema = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,48}$/) }).strict();

// ---------------------------------------------------------------------------------------------------------------------
// Admins

/** A tournament as the panel shows it. */
export interface AdminTournament {
  id: string;
  state: TournamentState;
  version: number;
  record: TournamentRecord;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  scheduledAt: string | null;
  scheduledBy: string | null;
  publishedAt: string | null;
  /** In it now, and who left it. */
  entrants: number;
  left: number;
  disqualified: number;
  /** Checks not done yet, and checks that wait for an admin's decision. */
  pending: number;
  undecided: number;
  /** Money still to pay. */
  cashPending: number;
  /** Why scheduling it needs a superadmin (empty: any admin). */
  bigReasons: TournamentBigReason[];
}

export interface AdminTournamentList {
  tournaments: AdminTournament[];
  now: string;
}

/** A replay check: `pending` (not done yet), `ok`, `mismatch` (the run became suspicious), `unverifiable` or `error`. */
export type TournamentCheckStatus = 'pending' | 'ok' | 'mismatch' | 'error' | 'unverifiable';

/** Why a run could not be checked. */
export type UnverifiableReason = 'inputs_missing' | 'inputs_unreadable' | 'sim_version' | 'content_unreadable' | 'coop';

export interface AdminTournamentCheck {
  runId: string;
  username: string;
  finishedAt: string;
  status: TournamentCheckStatus;
  /** What the replay found: the figures compared, or why it could not be checked. */
  detail: { reason?: UnverifiableReason | string; rows?: CheckRow[] } | null;
  /** An admin's decision on a run that could not be checked (`discard`: it stops counting in this tournament). */
  decision: 'accept' | 'discard' | null;
  decidedBy: string | null;
  decidedAt: string | null;
  checkedAt: string | null;
}

export interface AdminTournamentRankRow extends Omit<TournamentRankRow, 'me'> {
  /** Runs that count. */
  runs: number;
  /** What it would take if the results were published now. */
  rewards: TournamentRewards | null;
}

export interface AdminTournamentCash {
  tournamentId: string;
  slug: string;
  title: string;
  username: string;
  rank: number;
  amountEur: number;
  note: string;
  paidAt: string | null;
  paidBy: string | null;
}

/** GET /galaxy/api/admin/tournaments/:id/review: everything the review panel shows. */
export interface AdminTournamentReview {
  tournament: AdminTournament;
  /** The ranking as it stands (frozen once finished). */
  ranking: AdminTournamentRankRow[];
  checks: AdminTournamentCheck[];
  disqualified: { username: string; reason: string | null }[];
  /** The earliest the results publish on their own (the end plus the review hours). */
  publishAt: string;
  /** Nothing pending: «Publicar ya» works (and, after publishAt, the job publishes). */
  canPublish: boolean;
  cash: AdminTournamentCash[];
}

const reason = z.string().trim().min(3).max(500);
const password = z.string().min(1).max(200);
const version = z.number().int().min(1);

/**
 * POST /galaxy/api/admin/tournaments/validate: everything that would keep the record from being scheduled now (`id`: the
 * draft being edited, so its own slug is not taken). Saving a draft lets its season be a draft too.
 */
export const tournamentValidateBodySchema = z.object({ record: z.unknown(), id: z.uuid().optional() }).strict();
export interface TournamentValidation {
  ok: boolean;
  issues: TournamentIssue[];
  /** Why scheduling it would need a superadmin. */
  bigReasons: TournamentBigReason[];
}
/** POST /galaxy/api/admin/tournaments (a new draft). */
export const tournamentCreateBodySchema = z.object({ record: z.unknown(), reason }).strict();
/** POST /galaxy/api/admin/tournaments/:id (a draft replaced whole, at the version the admin read). */
export const tournamentUpdateBodySchema = z.object({ record: z.unknown(), version, reason }).strict();
/** POST …/:id/delete (a draft). */
export const tournamentDeleteBodySchema = z.object({ reason }).strict();
/** POST …/:id/schedule (at the version the admin reviewed). */
export const tournamentScheduleBodySchema = z.object({ version, reason, password }).strict();
/** POST …/:id/unschedule, …/:id/cancel, …/:id/publish. */
export const tournamentActionBodySchema = z.object({ reason, password }).strict();
/** POST …/:id/checks/:run/decide. */
export const tournamentDecideBodySchema = z.object({ decision: z.enum(['accept', 'discard']), reason, password }).strict();
/** POST …/:id/entries/:username/disqualify (false: back in). */
export const tournamentDisqualifyBodySchema = z.object({ disqualified: z.boolean(), reason, password }).strict();
/** POST …/:id/cash/:username/paid. */
export const tournamentCashBodySchema = z.object({ reason, password }).strict();

export const tournamentCheckParamsSchema = z.object({ id: z.uuid(), run: z.uuid() }).strict();
export const tournamentEntryParamsSchema = z.object({ id: z.uuid(), username: usernameSchema }).strict();

/** The in-game path of a tournament's page (the mailbox's button, the live toasts). */
export const tournamentPath = (slug: string) => `/torneos/${slug}`;

