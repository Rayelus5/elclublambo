import type { ColumnType, Generated } from 'kysely';

/** Kysely types for schema `galaxy` (supabase/migrations/*_galaxy_*.sql). Keys are schema-qualified. */

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type TimestampRequired = ColumnType<Date, Date | string, Date | string>;

export interface AccountsTable {
  id: Generated<string>;
  username: string;
  password_hash: string;
  created_at: Timestamp;
  banned_until: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  ban_reason: string | null;
  /** M6a: left out of the season leaderboard by an admin. */
  leaderboard_excluded: Generated<boolean>;
  /** M7a: the title and the frame the account shows (among its cosmetics). */
  title: ColumnType<string | null, string | null | undefined, string | null>;
  frame: ColumnType<string | null, string | null | undefined, string | null>;
  /** Nov plan C2: the avatar shown (null: the drawing made from the name) and the galaxy shown as the profile banner. */
  avatar: ColumnType<string | null, string | null | undefined, string | null>;
  banner: ColumnType<string | null, string | null | undefined, string | null>;
  /** Plan «escáner pro», part F: anonymised and closed by an admin («Eliminar»). */
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface AccountRolesTable {
  account_id: string;
  role: 'superadmin' | 'admin' | 'moderator';
  granted_at: Timestamp;
}

export interface ReservedUsernamesTable {
  username: string;
}

export interface SessionsTable {
  id: Generated<string>;
  account_id: string;
  token_hash: Buffer;
  mfa: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Timestamp;
  expires_at: TimestampRequired;
  last_seen_at: Timestamp;
  ip: string | null;
  user_agent: string | null;
}

export interface LoginChallengesTable {
  id: Generated<string>;
  account_id: string;
  token_hash: Buffer;
  created_at: Timestamp;
  expires_at: TimestampRequired;
  used_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface AdminTotpTable {
  account_id: string;
  secret_enc: Buffer;
  /** bigint in Postgres; pg returns it as a string. */
  last_used_step: ColumnType<string, number | string | undefined, number | string>;
  created_at: Timestamp;
}

export interface ResetCodesTable {
  id: Generated<string>;
  account_id: string;
  code_hash: Buffer;
  created_at: Timestamp;
  expires_at: TimestampRequired;
  used_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_by: string | null;
}

export interface AdminAuditLogTable {
  id: Generated<string>;
  at: Timestamp;
  actor_id: string | null;
  actor_label: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  before: unknown;
  after: unknown;
  reason: string;
  ip: string | null;
}

export interface GameConfigVersionsTable {
  id: Generated<string>;
  key: string;
  version: number;
  data: unknown;
  created_at: Timestamp;
  created_by: string | null;
  note: string;
}

export interface GameConfigActiveView {
  key: string;
  version: number;
  data: unknown;
  created_at: Date;
  created_by: string | null;
  note: string;
}

/** Numeric columns (bigint, numeric) come back from pg as strings; they are written as numbers or strings. */
type BigNum = ColumnType<string, string | number | bigint, string | number | bigint>;

export interface BalancesTable {
  account_id: string;
  currency: string;
  amount: BigNum;
}

export interface LedgerTable {
  id: Generated<string>;
  account_id: string;
  currency: string;
  delta: BigNum;
  balance_after: BigNum;
  reason: string;
  ref: ColumnType<unknown, string | undefined, never>;
  operation_key: string | null;
  created_at: Timestamp;
}

export interface OperationsTable {
  account_id: string;
  key: string;
  kind: string;
  request_hash: string;
  result: ColumnType<unknown, string, never>;
  created_at: Timestamp;
}

export interface GalaxiesTable {
  id: Generated<string>;
  owner_id: string;
  seed: BigNum;
  engine_version: string;
  traits: ColumnType<Record<string, string>, string, string>;
  dna: string;
  name: string;
  designation: string;
  tier: number;
  score: number;
  finish: string;
  featured: Generated<boolean>;
  level: Generated<number>;
  /** M4c-1: the dust put into its levels (partly returned when fused or disintegrated). */
  level_dust: Generated<number>;
  /** Plan phase 2: locked by its owner (never fused nor disintegrated). */
  locked: Generated<boolean>;
  season: string | null;
  origin: 'pull' | 'fusion' | 'grant';
  lineage: ColumnType<string[], string[] | undefined, string[]>;
  created_at: Timestamp;
  disintegrated_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface GachaAccountsTable {
  account_id: string;
  welcome_granted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  last_free_day: ColumnType<string | null, string | null | undefined, string | null>;
}

export interface GachaStateTable {
  account_id: string;
  pity_group: string;
  since_legendary: Generated<number>;
  since_featured: Generated<number>;
  welcome: Generated<boolean>;
  total_pulls: Generated<number>;
}

export interface GachaPullsTable {
  id: Generated<string>;
  account_id: string;
  banner: string;
  pity_group: string;
  seed: BigNum;
  tier: number;
  featured: boolean;
  finish: string;
  pity_before: number;
  config_version: number;
  engine_version: string;
  galaxy_id: string;
  operation_key: string;
  created_at: Timestamp;
}

/** Hangar (GDD §5.1, §8.4): chosen probe and open relic slots. */
/** The station (M4a, GDD §10): the level of each room, the refinery's queue and the antenna's clock. */
/** M4b-2: a Laboratorio node an account has bought, and its level (no row: level 0). */
/** Probes an admin unlocked for an account (M6d-4). */
export interface ProbeGrantsTable {
  account_id: string;
  probe: string;
  created_at: Timestamp;
}

/** Season points an admin added or took away (M6d-4); rows are only added. */
export interface SeasonAdjustmentsTable {
  id: Generated<string>;
  account_id: string;
  season: string;
  points: number;
  /** M7a: an admin's, a mission's or an achievement's. */
  source: ColumnType<'admin' | 'mission' | 'achievement', 'admin' | 'mission' | 'achievement' | undefined, never>;
  created_at: Timestamp;
}

/** M7a: what each mission of a period has counted, and when it was collected. */
export interface MissionProgressTable {
  account_id: string;
  period: string;
  mission: string;
  progress: ColumnType<string | number, number, number>;
  claimed_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  updated_at: Timestamp;
}

/** M7a: what each achievement has counted, when it was reached and when it was collected. */
export interface AchievementProgressTable {
  account_id: string;
  achievement: string;
  progress: ColumnType<string | number, number, number>;
  unlocked_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  claimed_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  updated_at: Timestamp;
}

/** M7b: the ECN Catalogue's rewards an account has collected. */
export interface CatalogClaimsTable {
  account_id: string;
  percent: number;
  claimed_at: Timestamp;
}

/** M7d-1: a season route step an account has collected (by the step's points). */
export interface SeasonRouteClaimsTable {
  account_id: string;
  season: string;
  step: number;
  claimed_at: Timestamp;
}

/** M7d-1: how many of a season shop item an account has bought. */
export interface SeasonPurchasesTable {
  account_id: string;
  season: string;
  item: string;
  bought: Generated<number>;
  updated_at: Timestamp;
}

/** M7d-2: a closed season (the hall of fame). */
export interface SeasonArchiveTable {
  season: string;
  name: string;
  starts_at: ColumnType<Date, Date | string, Date | string>;
  ends_at: ColumnType<Date, Date | string, Date | string>;
  players: Generated<number>;
  closed_at: Timestamp;
}

/** M7d-2: an account's final place in a closed season, with the rewards kept from that close. */
export interface SeasonResultsTable {
  season: string;
  account_id: string;
  rank: number;
  score: number;
  tier: string | null;
  podium: Generated<boolean>;
  rewards: ColumnType<unknown, string, string>;
  claimed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

/** M7e-1: what a clan's members have added to one of an event's clan goals. */
export interface ClanEventProgressTable {
  clan_id: string;
  event: string;
  goal: string;
  progress: ColumnType<string | number, number, number>;
  updated_at: Timestamp;
}

/** M7e-2: an account's rank in the prestige «Corrimiento al rojo». */
export interface RedshiftTable {
  account_id: string;
  rank: number;
  updated_at: Timestamp;
}

/** Polish phase 3: an account's guided tutorial (chapter reached, skipped, done, and its one gift). */
export interface TutorialTable {
  account_id: string;
  chapter: string;
  started_at: Timestamp;
  updated_at: Timestamp;
  skipped_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  done_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  gift_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

/** M7a: the titles and frames an account has earned (and avatars, Nov plan C2; probe skins, part C of the plan «skins»). */
export interface CosmeticsTable {
  account_id: string;
  kind: 'title' | 'frame' | 'avatar' | 'skin';
  value: string;
  created_at: Timestamp;
}

export interface LabNodesTable {
  account_id: string;
  node: string;
  level: number;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/** Shop and lab plan F2a: the Laboratorio's seasonal core, a node's level in one season (no row: level 0). */
export interface LabSeasonNodesTable {
  account_id: string;
  season: string;
  node: string;
  level: number;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/** Shop and lab plan F4: a payment of the resource shop, from its checkout to its delivery (and any refund). */
export interface ShopPurchasesTable {
  id: Generated<string>;
  account_id: string;
  product: string;
  snapshot: ColumnType<unknown, string, string>;
  amount_cents: number;
  currency: Generated<string>;
  stripe_price_id: string;
  first_bonus: Generated<boolean>;
  status: ColumnType<string, string | undefined, string>;
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  granted: ColumnType<unknown | null, string | null | undefined, string | null>;
  clawed: ColumnType<unknown, string | undefined, string>;
  refunded_cents: Generated<number>;
  consent_at: ColumnType<Date, Date | string, Date | string>;
  terms_version: string;
  madrid_day: ColumnType<string, string, string>;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
  expires_at: ColumnType<Date, Date | string, Date | string>;
  paid_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/** Shop and lab plan F4: a Stripe event already handled (append-only). */
export interface ShopStripeEventsTable {
  id: string;
  type: string;
  purchase_id: string | null;
  received_at: ColumnType<Date, Date | string | undefined, never>;
}

/** Shop and lab plan F4: something about a purchase the admin must look at. */
export interface ShopAlertsTable {
  id: Generated<string>;
  kind: string;
  account_id: string | null;
  purchase_id: string | null;
  details: ColumnType<unknown, string | undefined, string>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  reviewed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  reviewed_by: string | null;
}

/** Shop and lab plan F4: an account whose shop is closed until an admin opens it. */
export interface ShopBlocksTable {
  account_id: string;
  reason: string;
  purchase_id: string | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  created_by: string | null;
}

/** Plan «skins», part D: the probes a player shows on their profile, by slot (0–2). */
/** Plan «referidos»: a referral code and its owner. */
export interface ReferralCodesTable {
  id: Generated<string>;
  code: string;
  owner_id: string;
  enabled: ColumnType<boolean, boolean | undefined, boolean>;
  max_uses: number | null;
  expires_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  note: string | null;
  created_by: string | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

/** Plan «referidos»: an owner's own gifts and level (null: the global ones). */
export interface ReferralRewardsTable {
  owner_id: string;
  owner_gifts: ColumnType<Record<string, number> | null, string | null, string | null>;
  newcomer_gifts: ColumnType<Record<string, number> | null, string | null, string | null>;
  activation_level: number | null;
  updated_by: string | null;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/** Plan «referidos»: one row per newcomer that signed up with a code. */
export interface ReferralsTable {
  account_id: string;
  code_id: string;
  owner_id: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  signup_ip: string | null;
  user_agent: string | null;
  state: ColumnType<'pending' | 'held' | 'rewarded' | 'rejected', 'pending' | 'held' | undefined, 'pending' | 'held' | 'rewarded' | 'rejected'>;
  flags: ColumnType<string[], string[] | undefined, string[]>;
  newcomer_paid_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  owner_paid_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  activated_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  reviewed_by: string | null;
  reviewed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface ProbeShowcaseTable {
  account_id: string;
  slot: number;
  probe: string;
}

/** M4b-1: a probe's level and chosen starting weapon (no row: level 1, base weapon). */
export interface ProbeLevelsTable {
  account_id: string;
  probe: string;
  level: ColumnType<number, number | undefined, number>;
  variant: string | null;
  /** The skin it wears (plan «skins», part C; null: its base drawing). */
  skin: ColumnType<string | null, string | null | undefined, string | null>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface StationRoomsTable {
  account_id: string;
  room: string;
  level: number;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface RefineryTable {
  account_id: string;
  queue: ColumnType<number, number | undefined, number>;
  ready: ColumnType<number, number | undefined, number>;
  clock: ColumnType<Date, Date | undefined, Date>;
}

export interface AntennaTable {
  account_id: string;
  clock: ColumnType<Date, Date | undefined, Date>;
}

export interface HangarsTable {
  account_id: string;
  probe: ColumnType<string, string | undefined, string>;
  sector: ColumnType<string, string | undefined, string>;
  relic_slots: ColumnType<number, number | undefined, number>;
  updated_at: Timestamp;
}

export interface LoadoutsTable {
  account_id: string;
  slot: number;
  galaxy_id: string;
}

/** The chats' messages (M5b-2): hidden by a moderator or by reports, never deleted. */
export interface ChatMessagesTable {
  id: ColumnType<string, never, never>;
  channel: string;
  author_id: string;
  body: string;
  created_at: Timestamp;
  hidden_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  hidden_by: string | null;
  hidden_reason: 'moderator' | 'reports' | 'deleted' | null;
  /** Its reports, those waiting since its last review, and the newest one's time (kept by triggers). */
  report_count: Generated<number>;
  report_pending: Generated<number>;
  report_last_at: ColumnType<Date | null, never, never>;
}

/** One report per account and message (M5b-2). */
export interface ChatReportsTable {
  message_id: string | number;
  reporter_id: string;
  reason: string | null;
  created_at: Timestamp;
}

/** An account that cannot write until `until` (M5b-2). */
/** What an account has read in a channel (by its key), and the mentions of it (the owner's chat asks, 2026-11-14). */
export interface ChatReadsTable {
  account_id: string;
  channel: string;
  last_read_id: ColumnType<string, string | number, string | number>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface ChatMentionsTable {
  message_id: ColumnType<string, string | number, never>;
  account_id: string;
  channel: string;
}

export interface ChatMutesTable {
  account_id: string;
  until: ColumnType<Date, Date | string, Date | string>;
  reason: string;
  by_id: string | null;
  created_at: Timestamp;
}

/** The last review of a reported message (M6c-1): hidden or kept visible; only reports after it count. */
export interface ChatReportReviewsTable {
  message_id: string | number;
  outcome: 'hidden' | 'kept';
  by_id: string | null;
  reason: string;
  reviewed_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/** A galaxy for sale (M5c-1): in escrow while active; sold once, withdrawn or expired. Never deleted. */
export interface MarketListingsTable {
  id: Generated<string>;
  galaxy_id: string;
  seller_id: string;
  price: BigNum;
  listed_at: Timestamp;
  expires_at: TimestampRequired;
  status: ColumnType<'active' | 'sold' | 'cancelled' | 'expired', 'active' | undefined, 'sold' | 'cancelled' | 'expired'>;
  buyer_id: string | null;
  sold_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  commission: ColumnType<string | null, number | null | undefined, number | null>;
}

/** The IPs an account signed in from, kept after its sessions end (M5c-1 review: the market's shared-IP alerts). */
export interface AccountIpsTable {
  account_id: string;
  ip: string;
  first_seen: Timestamp;
  last_seen: Timestamp;
}

/** A swap of one galaxy for one galaxy (M5c-2): a_* proposed, b_* is the other side. Never deleted. */
export interface TradesTable {
  id: Generated<string>;
  version: Generated<number>;
  status: ColumnType<'open' | 'done' | 'cancelled' | 'expired', 'open' | undefined, 'done' | 'cancelled' | 'expired'>;
  a_id: string;
  b_id: string;
  a_galaxy: string | null;
  b_galaxy: string | null;
  a_offered: Generated<boolean>;
  b_offered: Generated<boolean>;
  a_confirmed: Generated<boolean>;
  b_confirmed: Generated<boolean>;
  created_at: Timestamp;
  expires_at: TimestampRequired;
  closed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

/** A sale the admin should look at (M5c-1): an IP shared by buyer and seller, or a price far above the floor. */
export interface TradeAlertsTable {
  id: ColumnType<string, never, never>;
  kind: 'shared_ip' | 'unbalanced';
  listing_id: string | null;
  /** M5c-2: an alert about a swap. */
  trade_id: string | null;
  seller_id: string | null;
  buyer_id: string | null;
  details: ColumnType<unknown, string | undefined, never>;
  created_at: Timestamp;
  /** M6c-2: reviewed by an admin, with a reason (the reviewer may be gone). */
  reviewed_at: ColumnType<Date | null, never, Date | string>;
  reviewed_by: ColumnType<string | null, never, string | null>;
  review_reason: ColumnType<string | null, never, string>;
}

/** A sale or a done trade reverted by an admin (M6c-2): one per deal; the deal keeps its status. */
export interface DealReversalsTable {
  id: ColumnType<string, never, never>;
  listing_id: string | null;
  trade_id: string | null;
  by_id: string | null;
  reason: string;
  details: ColumnType<unknown, string | undefined, never>;
  created_at: Timestamp;
}

/** A mailbox message (M6d-1): news for everyone or a segment, with gifts; withdrawn, never edited or deleted. */
export interface MailboxMessagesTable {
  id: Generated<string>;
  title: string;
  body: string;
  gifts: ColumnType<unknown, string, never>;
  audience: ColumnType<unknown, string, never>;
  created_by: string | null;
  created_at: Timestamp;
  expires_at: ColumnType<Date, Date | string, never>;
  withdrawn_at: ColumnType<Date | null, never, Date | string>;
}

/** A message's receipt by an account (M6d-1): read, and its gift claimed once. */
export interface MailboxReceiptsTable {
  message_id: string;
  account_id: string;
  read_at: ColumnType<Date | null, Date | string | null | undefined, Date | string>;
  claimed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string>;
}

/** A notice of the title screen (M6d-1), shown between two dates unless ended early. */
export interface TitleNoticesTable {
  id: Generated<string>;
  text: string;
  tone: 'info' | 'warning';
  starts_at: ColumnType<Date, Date | string, never>;
  ends_at: ColumnType<Date, Date | string, never>;
  created_by: string | null;
  created_at: Timestamp;
  ended_at: ColumnType<Date | null, never, Date | string>;
}

/** The news board's cards (2026-11-14): custom ones, and one of each auto card (its words come from the game). */
export interface NewsPostsTable {
  id: Generated<string>;
  kind: string;
  section: string;
  title: Generated<string>;
  body: Generated<string>;
  image: ColumnType<unknown, string | null | undefined, string | null>;
  link: ColumnType<unknown, string | null | undefined, string | null>;
  featured: Generated<boolean>;
  sort: Generated<number>;
  starts_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  ends_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  hidden: Generated<boolean>;
  created_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** Images the admin uploaded for the news board (PNG, JPG or WebP, 2 MB at most), served from the same origin. */
export interface MediaAssetsTable {
  id: Generated<string>;
  name: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  data: Buffer;
  created_by: string | null;
  created_at: Timestamp;
}

/** Clans (M5b-1): a unique name (whatever the case), a unique tag in capitals, an emblem and a colour. */
export interface ClansTable {
  id: Generated<string>;
  name: string;
  tag: string;
  description: ColumnType<string, string | undefined, string>;
  emblem: string;
  color: string;
  open: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: Timestamp;
}

/** A clan's members: one clan per account, one leader per clan (M5b-1). */
export interface ClanMembersTable {
  account_id: string;
  clan_id: string;
  role: 'leader' | 'officer' | 'member';
  joined_at: Timestamp;
}

/** A kicked account waits until `until` before joining that clan again or asking to (M5b-1 review). */
export interface ClanKicksTable {
  clan_id: string;
  account_id: string;
  until: ColumnType<Date, Date | string, Date | string>;
}

/** Requests to join a closed clan (M5b-1). */
export interface ClanRequestsTable {
  clan_id: string;
  account_id: string;
  created_at: Timestamp;
}

/** The experience each account's runs gave (bigint, read as a decimal string; M5a). */
/** Plan phase 3: friendships (one row per ordered pair), blocks and the social preferences. */
export interface FriendshipsTable {
  a: string;
  b: string;
  status: 'pending' | 'accepted';
  requested_by: string;
  created_at: Timestamp;
  accepted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface BlocksTable {
  blocker: string;
  blocked: string;
  created_at: Timestamp;
}

export interface SocialPrefsTable {
  account_id: string;
  invites: string;
  show_status: boolean;
  /** Real-time notices plan: 'sound' | 'silent' | 'off'. */
  notices: Generated<string>;
  updated_at: Timestamp;
}

export interface AccountXpTable {
  account_id: string;
  xp: BigNum;
  updated_at: Timestamp;
}

/** The galaxies an account exhibits in its planetarium, one per pedestal (M4c-2). */
/** Plan «notas de versión»: the panel's release notes; one with a code note's id replaces (or hides) it. */
export interface ReleaseNotesTable {
  id: string;
  version: string;
  date: ColumnType<Date, Date | string, Date | string>;
  title: string;
  summary: Generated<string>;
  items: unknown;
  hidden: Generated<boolean>;
  updated_by: string | null;
  updated_at: Timestamp;
}

/** Plan «ajustes en la cuenta»: the player's settings (accountSettingsSchema), one row per account. */
export interface SettingsTable {
  account_id: string;
  data: unknown;
  updated_at: Timestamp;
}

/** Plan «escáner pro», part E: the galaxies a player chose for the title screen's sky (up to 12). */
export interface BackdropsTable {
  account_id: string;
  slot: number;
  galaxy_id: string;
}

export interface ExhibitsTable {
  account_id: string;
  slot: number;
  galaxy_id: string;
}

/** A visit to someone's planetarium: one per visitor, owner and UTC day, never one's own (M4c-2). */
export interface PlanetariumVisitsTable {
  owner_id: string;
  visitor_id: string;
  day: ColumnType<string, string | undefined, never>;
}

type Maybe<T> = ColumnType<T | null, T | null | undefined, T | null>;

/** A run: started with the server's seed and relic snapshot, finished once (GDD §14.7). */
export interface RunsTable {
  id: Generated<string>;
  account_id: string;
  seed: BigNum;
  sector: string;
  probe: string;
  relics: ColumnType<unknown, string, never>;
  /** M4b-1: the probe level's bonuses and the starting-weapon variant the run started with. */
  upgrades: ColumnType<unknown, string | undefined, never>;
  content_version: number;
  sim_version: string;
  start_key: string;
  started_at: Timestamp;
  finished_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  outcome: Maybe<'extracted' | 'died' | 'abandoned'>;
  ticks: Maybe<number>;
  depth: Maybe<number>;
  kills: Maybe<number>;
  boss_kills: Maybe<number>;
  level: Maybe<number>;
  seconds: Maybe<number>;
  hash: Maybe<string>;
  payout: ColumnType<unknown, string | null | undefined, string | null>;
  /** The figures the client sent at the finish, before the server clipped them (M6d-3 review); null before that. */
  claim: ColumnType<unknown, string | null | undefined, string | null>;
  runs_version: Maybe<number>;
  flags: ColumnType<string[], string[] | undefined, string[]>;
  suspicious: ColumnType<boolean, boolean | undefined, boolean>;
  /** Plan phase 6: the co-op run it belongs to and its place, how many started it, the factor on its season points. */
  coop_run_id: ColumnType<string | null, string | null | undefined, never>;
  slot: ColumnType<number | null, number | null | undefined, never>;
  party_size: ColumnType<number, number | undefined, never>;
  points_factor: ColumnType<number, number | undefined, never>;
  /** Phase 6c: when the player left this group run on purpose (null: stayed, or a solo run). */
  left_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

/** Plan phase 6: a co-op run and its sealed inputs. */
export interface CoopRunsTable {
  id: Generated<string>;
  room_code: string;
  kind: 'public' | 'friends' | 'private';
  leader_id: string | null;
  sector: string;
  seed: BigNum;
  anomaly: string | null;
  rules: ColumnType<unknown, string, never>;
  players: ColumnType<unknown, string, never>;
  content_version: number;
  sim_version: string;
  state: ColumnType<'running' | 'ended' | 'interrupted', 'running' | undefined, 'ended' | 'interrupted'>;
  outcome: Maybe<'extracted' | 'died' | 'interrupted'>;
  ticks: Maybe<number>;
  depth: Maybe<number>;
  boss_kills: Maybe<number>;
  hash: Maybe<string>;
  started_at: Timestamp;
  ended_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

/** Open beta: event signals left over when their scanner closed, turned into star dust (shown once). */
export interface EventLeftoversTable {
  id: Generated<string>;
  account_id: string;
  currency: string;
  label: string;
  signals: number;
  dust: number;
  created_at: Generated<Date>;
  seen_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
}

/** Multiplayer plan phase 7: a teammate's report of a player of a group run, and its review. */
export interface PlayerReportsTable {
  id: Generated<string>;
  reporter_id: string;
  reported_id: string;
  coop_run_id: string;
  reason: string;
  note: string | null;
  created_at: Generated<Date>;
  reviewed_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  reviewed_by: ColumnType<string | null, string | null | undefined, string | null>;
  outcome: ColumnType<'dismissed' | 'actioned' | null, 'dismissed' | 'actioned' | null | undefined, 'dismissed' | 'actioned' | null>;
  review_note: ColumnType<string | null, string | null | undefined, string | null>;
}

export interface CoopRunInputsTable {
  coop_run_id: string;
  inputs: Buffer;
  ticks: ColumnType<number, number | undefined, number>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface RunInputsTable {
  run_id: string;
  inputs: Buffer;
  created_at: Timestamp;
}

/** The probe test, answered once per account (GDD §6). */
export interface ProbeTestsTable {
  account_id: string;
  answers: ColumnType<number[], number[], never>;
  probe: string;
  created_at: Timestamp;
}

export interface RunDaysTable {
  account_id: string;
  day: ColumnType<string, string, string>;
  seconds: ColumnType<number, number | undefined, number>;
}

export interface DB {
  'galaxy.accounts': AccountsTable;
  'galaxy.account_roles': AccountRolesTable;
  'galaxy.reserved_usernames': ReservedUsernamesTable;
  'galaxy.sessions': SessionsTable;
  'galaxy.login_challenges': LoginChallengesTable;
  'galaxy.admin_totp': AdminTotpTable;
  'galaxy.reset_codes': ResetCodesTable;
  'galaxy.admin_audit_log': AdminAuditLogTable;
  'galaxy.game_config_versions': GameConfigVersionsTable;
  'galaxy.game_config_active': GameConfigActiveView;
  'galaxy.balances': BalancesTable;
  'galaxy.ledger': LedgerTable;
  'galaxy.operations': OperationsTable;
  'galaxy.galaxies': GalaxiesTable;
  'galaxy.gacha_accounts': GachaAccountsTable;
  'galaxy.gacha_state': GachaStateTable;
  'galaxy.gacha_pulls': GachaPullsTable;
  'galaxy.hangars': HangarsTable;
  'galaxy.loadouts': LoadoutsTable;
  'galaxy.runs': RunsTable;
  'galaxy.run_inputs': RunInputsTable;
  'galaxy.coop_runs': CoopRunsTable;
  'galaxy.coop_run_inputs': CoopRunInputsTable;
  'galaxy.player_reports': PlayerReportsTable;
  'galaxy.event_leftovers': EventLeftoversTable;
  'galaxy.run_days': RunDaysTable;
  'galaxy.probe_tests': ProbeTestsTable;
  'galaxy.probe_levels': ProbeLevelsTable;
  'galaxy.probe_showcase': ProbeShowcaseTable;
  'galaxy.referral_codes': ReferralCodesTable;
  'galaxy.referral_rewards': ReferralRewardsTable;
  'galaxy.referrals': ReferralsTable;
  'galaxy.lab_nodes': LabNodesTable;
  'galaxy.lab_season_nodes': LabSeasonNodesTable;
  'galaxy.shop_purchases': ShopPurchasesTable;
  'galaxy.shop_stripe_events': ShopStripeEventsTable;
  'galaxy.shop_alerts': ShopAlertsTable;
  'galaxy.shop_blocks': ShopBlocksTable;
  'galaxy.probe_grants': ProbeGrantsTable;
  'galaxy.season_adjustments': SeasonAdjustmentsTable;
  'galaxy.mission_progress': MissionProgressTable;
  'galaxy.achievement_progress': AchievementProgressTable;
  'galaxy.cosmetics': CosmeticsTable;
  'galaxy.catalog_claims': CatalogClaimsTable;
  'galaxy.season_route_claims': SeasonRouteClaimsTable;
  'galaxy.season_purchases': SeasonPurchasesTable;
  'galaxy.season_archive': SeasonArchiveTable;
  'galaxy.clan_event_progress': ClanEventProgressTable;
  'galaxy.redshift': RedshiftTable;
  'galaxy.tutorial': TutorialTable;
  'galaxy.friendships': FriendshipsTable;
  'galaxy.blocks': BlocksTable;
  'galaxy.social_prefs': SocialPrefsTable;
  'galaxy.season_results': SeasonResultsTable;
  'galaxy.exhibits': ExhibitsTable;
  'galaxy.backdrops': BackdropsTable;
  'galaxy.settings': SettingsTable;
  'galaxy.release_notes': ReleaseNotesTable;
  'galaxy.account_xp': AccountXpTable;
  'galaxy.clans': ClansTable;
  'galaxy.clan_members': ClanMembersTable;
  'galaxy.clan_requests': ClanRequestsTable;
  'galaxy.clan_kicks': ClanKicksTable;
  'galaxy.chat_messages': ChatMessagesTable;
  'galaxy.chat_reads': ChatReadsTable;
  'galaxy.chat_mentions': ChatMentionsTable;
  'galaxy.chat_reports': ChatReportsTable;
  'galaxy.chat_mutes': ChatMutesTable;
  'galaxy.chat_report_reviews': ChatReportReviewsTable;
  'galaxy.deal_reversals': DealReversalsTable;
  'galaxy.mailbox_messages': MailboxMessagesTable;
  'galaxy.mailbox_receipts': MailboxReceiptsTable;
  'galaxy.title_notices': TitleNoticesTable;
  'galaxy.news_posts': NewsPostsTable;
  'galaxy.media_assets': MediaAssetsTable;
  'galaxy.market_listings': MarketListingsTable;
  'galaxy.trade_alerts': TradeAlertsTable;
  'galaxy.account_ips': AccountIpsTable;
  'galaxy.trades': TradesTable;
  'galaxy.planetarium_visits': PlanetariumVisitsTable;
  'galaxy.station_rooms': StationRoomsTable;
  'galaxy.refinery': RefineryTable;
  'galaxy.antenna': AntennaTable;
}
