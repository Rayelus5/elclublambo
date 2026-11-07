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
export interface HangarsTable {
  account_id: string;
  probe: ColumnType<string, string | undefined, string>;
  relic_slots: ColumnType<number, number | undefined, number>;
  updated_at: Timestamp;
}

export interface LoadoutsTable {
  account_id: string;
  slot: number;
  galaxy_id: string;
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
  runs_version: Maybe<number>;
  flags: ColumnType<string[], string[] | undefined, string[]>;
  suspicious: ColumnType<boolean, boolean | undefined, boolean>;
}

export interface RunInputsTable {
  run_id: string;
  inputs: Buffer;
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
  'galaxy.run_days': RunDaysTable;
}
