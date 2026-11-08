import { z } from 'zod';
import { usernameSchema } from '../account';

// Communication (GDD §16.5; M6d-1): the mailbox (news for everyone or for a segment, with gifts attached) and the
// notices of the title screen. A message reaches the accounts that existed when it was sent (so a gift cannot be farmed
// with new accounts) and match its audience; each one reads it and claims its gift once.

export const MAIL_GIFTS = ['coins', 'dust', 'signal'] as const;
export type MailGift = (typeof MAIL_GIFTS)[number];

export const mailGiftsSchema = z
  .object({
    coins: z.number().int().min(0).max(100_000).optional(),
    dust: z.number().int().min(0).max(100_000).optional(),
    signal: z.number().int().min(0).max(100).optional(),
  })
  .strict();
export type MailGifts = z.infer<typeof mailGiftsSchema>;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const mailAudienceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z
    .object({
      kind: z.literal('segment'),
      minLevel: z.number().int().min(1).max(99).optional(),
      maxLevel: z.number().int().min(1).max(99).optional(),
      joinedFrom: day.optional(),
      joinedTo: day.optional(),
      usernames: z.array(usernameSchema).min(1).max(200).optional(),
    })
    .strict()
    .refine((s) => s.minLevel !== undefined || s.maxLevel !== undefined || s.joinedFrom !== undefined || s.joinedTo !== undefined || s.usernames !== undefined, 'segment_empty')
    .refine((s) => s.minLevel === undefined || s.maxLevel === undefined || s.minLevel <= s.maxLevel, 'levels_order')
    .refine((s) => s.joinedFrom === undefined || s.joinedTo === undefined || s.joinedFrom <= s.joinedTo, 'dates_order'),
]);
export type MailAudience = z.infer<typeof mailAudienceSchema>;

const reason = z.string().trim().min(3).max(300);

export const adminMailPreviewSchema = z.object({ audience: mailAudienceSchema }).strict();
export const adminMailSendSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(2000),
    gifts: mailGiftsSchema.default({}),
    audience: mailAudienceSchema,
    expiresInDays: z.number().int().min(1).max(365).default(30),
    reason,
    password: z.string().min(1).max(200).optional(),
  })
  .strict();
export type AdminMailSend = z.infer<typeof adminMailSendSchema>;
export const adminNoticeSchema = z
  .object({ text: z.string().trim().min(1).max(200), tone: z.enum(['info', 'warning']), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), reason })
  .strict()
  .refine((n) => Date.parse(n.endsAt) > Date.parse(n.startsAt), 'notice_dates');
export const mailIdParamSchema = z.object({ id: z.string().uuid() }).strict();

/** Whether a message gives anything. */
export const hasGifts = (g: MailGifts): boolean => MAIL_GIFTS.some((k) => (g[k] ?? 0) > 0);

/**
 * Whether a message sent at `sentAt` reaches an account: it existed then, and it matches the segment (every condition
 * given; the join dates include both ends, read as UTC days).
 */
export function inAudience(audience: MailAudience, account: { level: number; createdAt: Date; username: string }, sentAt: Date): boolean {
  if (account.createdAt > sentAt) return false;
  if (audience.kind === 'all') return true;
  const joined = account.createdAt.toISOString().slice(0, 10);
  if (audience.minLevel !== undefined && account.level < audience.minLevel) return false;
  if (audience.maxLevel !== undefined && account.level > audience.maxLevel) return false;
  if (audience.joinedFrom !== undefined && joined < audience.joinedFrom) return false;
  if (audience.joinedTo !== undefined && joined > audience.joinedTo) return false;
  if (audience.usernames !== undefined && !audience.usernames.includes(account.username.toLowerCase())) return false;
  return true;
}

/** A message as its receiver sees it. */
export interface MailMessage {
  id: string;
  title: string;
  body: string;
  gifts: MailGifts;
  at: string;
  expiresAt: string;
  read: boolean;
  claimed: boolean;
}

export interface MyMailbox {
  messages: MailMessage[];
  unread: number;
}

export interface AdminMailRow {
  id: string;
  title: string;
  body: string;
  gifts: MailGifts;
  audience: MailAudience;
  by: string | null;
  at: string;
  expiresAt: string;
  withdrawnAt: string | null;
  /** Accounts it reaches (counted when listed), how many read it and how many claimed its gift. */
  recipients: number;
  read: number;
  claimed: number;
}

export interface TitleNotice {
  id: string;
  text: string;
  tone: 'info' | 'warning';
}

export interface AdminNoticeRow extends TitleNotice {
  startsAt: string;
  endsAt: string;
  endedAt: string | null;
  by: string | null;
  /** Shown right now. */
  live: boolean;
}
