import { z } from 'zod';
import { type Role, usernameSchema } from '../account';
import { GALAXY_TYPES } from './admin-progress';
import { FINISHES, TIERS } from '../gacha/types';

// The admin panel's players and audit (GDD §16.1, §16.2; M6a). Every change carries a reason; the destructive ones
// (taking currency, revoking a galaxy, experience, renaming, banning) also carry the admin's own password.

const reason = z.string().trim().min(3).max(300);
const password = z.string().min(1).max(200);

export const ADMIN_CURRENCIES = ['coins', 'dust', 'signal', 'material', 'components'] as const;
export type AdminCurrency = (typeof ADMIN_CURRENCIES)[number];

export const adminSearchSchema = z.object({ q: z.string().trim().min(1).max(64) }).strict();

export const adminWalletSchema = z
  .object({
    currency: z.enum(ADMIN_CURRENCIES),
    amount: z.number().int().min(-1_000_000_000).max(1_000_000_000).refine((n) => n !== 0, 'amount_zero'),
    reason,
    password: password.optional(),
  })
  .strict()
  // Taking currency away is destructive.
  .refine((v) => v.amount > 0 || v.password !== undefined, { message: 'password_required', path: ['password'] });
export type AdminWallet = z.infer<typeof adminWalletSchema>;

export const adminGalaxyGrantSchema = z
  .object({ tier: z.enum(TIERS), finish: z.enum(FINISHES), seed: z.string().regex(/^\d{1,20}$/).optional(), type: z.enum(GALAXY_TYPES).optional(), reason })
  .strict();
export type AdminGalaxyGrant = z.infer<typeof adminGalaxyGrantSchema>;

export const adminGalaxyRevokeSchema = z.object({ reason, password }).strict();
export const adminXpSchema = z.object({ xp: z.number().int().min(0).max(100_000_000), reason, password }).strict();
export const adminRenameSchema = z.object({ username: usernameSchema, reason, password }).strict();
/** `minutes: null` bans for good. */
export const adminBanSchema = z.object({ minutes: z.number().int().min(1).max(525_600 * 10).nullable(), reason, password }).strict();
export const adminReasonSchema = z.object({ reason }).strict();
export const adminLeaderboardSchema = z.object({ excluded: z.boolean(), reason }).strict();
export const adminUsernameParamSchema = z.object({ username: usernameSchema }).strict();

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const auditQuerySchema = z
  .object({
    actor: z.string().trim().min(1).max(64).optional(),
    action: z.string().trim().min(1).max(64).optional(),
    target: z.string().trim().min(1).max(64).optional(),
    from: day.optional(),
    to: day.optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .strict();
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export interface AdminPlayerRow {
  username: string;
  level: number;
  createdAt: string;
  lastSeen: string | null;
  banned: boolean;
  roles: Role[];
  clan: string | null;
}

export interface AdminPlayerList {
  players: AdminPlayerRow[];
}

/** Everything about a player at a glance; the long histories are its sections. */
export interface AdminPlayer {
  id: string;
  username: string;
  createdAt: string;
  roles: Role[];
  level: number;
  xp: number;
  /** null when not banned; `permanent` for a ban with no end. */
  banned: { until: string; permanent: boolean } | null;
  muted: { until: string; reason: string } | null;
  leaderboardExcluded: boolean;
  clan: { tag: string; name: string; role: string } | null;
  wallet: Record<AdminCurrency, number>;
  counts: { galaxies: number; runs: number; pulls: number; listings: number; trades: number; messages: number };
  sessions: { createdAt: string; expiresAt: string; ip: string | null; userAgent: string | null; mfa: boolean }[];
  ips: { ip: string; firstSeen: string; lastSeen: string }[];
  station: { room: string; level: number }[];
  lab: string[];
  probes: { probe: string; level: number }[];
}

export const ADMIN_SECTIONS = ['galaxies', 'ledger', 'pulls', 'runs', 'market', 'chat', 'social'] as const;
export type AdminSectionName = (typeof ADMIN_SECTIONS)[number];

/** A page of one of a player's histories, as table rows with the same keys each (newest first). */
export interface AdminSection {
  rows: Record<string, string | number | boolean | null>[];
  page: number;
  pages: number;
}

export interface AuditRow {
  id: string;
  at: string;
  actor: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  reason: string;
  ip: string | null;
}

export interface AuditPage {
  rows: AuditRow[];
  page: number;
  pages: number;
}
