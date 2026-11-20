import { z } from 'zod';
import { referralCodeSchema, usernameSchema } from '../account';
import { type MailGifts, mailGiftsSchema } from './mail';

// Referrals (plan «torneo, Temporada 2, Mítica y referidos», part R; the owner): admins give veteran players codes;
// a new player signs up with one; the new player gets a gift in the mailbox at once and the code's owner when the new
// player reaches a level. Gifts are global (live config `referrals`) or the owner's own. A sign-up that looks like the
// same person (same address as the owner or as another newcomer of the code, too many from one address, or past a
// code's or an owner's cap) is still created, but its gifts are held until an admin reviews it.

export const REFERRAL_STATES = ['pending', 'held', 'rewarded', 'rejected'] as const;
export type ReferralState = (typeof REFERRAL_STATES)[number];
/** Why a sign-up was held: the same address as the owner or as another newcomer of the code, too many from one address in a day, or a cap reached. */
export const REFERRAL_FLAGS = ['owner_ip', 'sibling_ip', 'ip_burst', 'code_cap', 'owner_cap'] as const;
export type ReferralFlag = (typeof REFERRAL_FLAGS)[number];

/** A referral's gifts: what the mailbox can carry (coins, dust and galaxy signals). */
export const referralGiftsSchema = mailGiftsSchema;
export type ReferralGifts = MailGifts;

/** The owner's own gifts and level, instead of the global ones (each one absent: the global one). */
export interface ReferralOverride {
  ownerGifts: ReferralGifts | null;
  newcomerGifts: ReferralGifts | null;
  activationLevel: number | null;
}
export interface ReferralRules {
  ownerGifts: ReferralGifts;
  newcomerGifts: ReferralGifts;
  activationLevel: number;
}

/** The rules a code follows: its owner's own where set, the global ones for the rest. */
export function referralRules(global: ReferralRules, own: ReferralOverride | null | undefined): ReferralRules {
  return {
    ownerGifts: own?.ownerGifts ?? global.ownerGifts,
    newcomerGifts: own?.newcomerGifts ?? global.newcomerGifts,
    activationLevel: own?.activationLevel ?? global.activationLevel,
  };
}

/** What the sign-up form needs before anyone signs in. */
export interface SignupOptions {
  referralRequired: boolean;
}

// ——— Admin ———

const iso = z.iso.datetime({ offset: true });
export const adminReferralCodeCreateSchema = z
  .object({
    owner: usernameSchema,
    /** Empty: one is made from the owner's name. */
    code: referralCodeSchema.optional(),
    maxUses: z.number().int().min(1).max(100_000).nullable().optional(),
    expiresAt: iso.nullable().optional(),
    note: z.string().trim().max(200).nullable().optional(),
    reason: z.string().trim().min(3).max(200),
  })
  .strict();
export const adminReferralCodeUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    maxUses: z.number().int().min(1).max(100_000).nullable().optional(),
    expiresAt: iso.nullable().optional(),
    note: z.string().trim().max(200).nullable().optional(),
    reason: z.string().trim().min(3).max(200),
  })
  .strict();
export const adminReferralReviewSchema = z.object({ decision: z.enum(['approve', 'reject']), reason: z.string().trim().min(3).max(200) }).strict();
export const adminReferralOverrideSchema = z
  .object({
    ownerGifts: referralGiftsSchema.nullable(),
    newcomerGifts: referralGiftsSchema.nullable(),
    activationLevel: z.number().int().min(1).max(100).nullable(),
    reason: z.string().trim().min(3).max(200),
  })
  .strict();
export const adminReferralListSchema = z
  .object({
    state: z.enum(REFERRAL_STATES).optional(),
    flagged: z.enum(['1']).optional(),
    q: z.string().trim().max(40).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .strict();
export type AdminReferralList = z.infer<typeof adminReferralListSchema>;

export interface AdminReferralCode {
  id: string;
  code: string;
  owner: string;
  enabled: boolean;
  maxUses: number | null;
  expiresAt: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  uses: number;
  rewarded: number;
  held: number;
}

export interface AdminReferralRow {
  username: string;
  code: string;
  owner: string;
  createdAt: string;
  state: ReferralState;
  flags: ReferralFlag[];
  ip: string | null;
  userAgent: string | null;
  level: number;
  activatedAt: string | null;
  newcomerPaid: boolean;
  ownerPaid: boolean;
  reviewedBy: string | null;
}

export interface AdminReferralSummary {
  codes: { active: number; total: number };
  signups: { days7: number; days30: number; total: number };
  /** Share of the newcomers that reached the owner's level (0..1), of those older than a day. */
  activation: number;
  held: number;
  rewarded: number;
}

export interface AdminReferralOwner {
  owner: string;
  override: ReferralOverride | null;
  rules: ReferralRules;
}

// ——— Player ———

/** The owner's own view: their codes and how many came in with them. */
export interface MyReferrals {
  codes: { code: string; enabled: boolean; uses: number; maxUses: number | null; expiresAt: string | null }[];
  joined: number;
  waiting: number;
  rewarded: number;
  /** The level a newcomer must reach for the owner's gift, and that gift. */
  activationLevel: number;
  ownerGifts: ReferralGifts;
  newcomerGifts: ReferralGifts;
}
