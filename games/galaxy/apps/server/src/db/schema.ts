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

export interface DB {
  'galaxy.accounts': AccountsTable;
  'galaxy.account_roles': AccountRolesTable;
  'galaxy.reserved_usernames': ReservedUsernamesTable;
  'galaxy.sessions': SessionsTable;
  'galaxy.login_challenges': LoginChallengesTable;
  'galaxy.admin_totp': AdminTotpTable;
  'galaxy.reset_codes': ResetCodesTable;
  'galaxy.admin_audit_log': AdminAuditLogTable;
}
