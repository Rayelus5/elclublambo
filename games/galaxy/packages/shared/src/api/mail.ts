import { z } from 'zod';
import { usernameSchema } from '../account';
import { MAIL_TYPES, type MailType } from '../gifts/library';
import { legacyToGifts } from '../gifts/rules';
import { FINISHES, TIERS, TRAIT_KEYS } from '../gacha/types';
import { giftBundleInputSchema, type GrantedItem, type MailContents } from '../gifts/schema';

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
/**
 * What a message gives (mail v2, 2026-11-16): loose gifts of any kind and packs of the library; the old shape (coins,
 * dust and signals as numbers) still arrives, read as the new one.
 */
export const mailGiftsInputSchema = z
  .union([giftBundleInputSchema, mailGiftsSchema])
  .transform((g) => ('items' in g || 'packs' in g ? (g as z.output<typeof giftBundleInputSchema>) : { items: legacyToGifts(g as MailGifts), packs: [] }));

export const adminMailSendSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(2000),
    /** What kind of message it is (its look in the mailbox); the game's own kinds are not an admin's. */
    type: z.enum(MAIL_TYPES).default('announcement'),
    gifts: mailGiftsInputSchema.default({ items: [], packs: [] }),
    audience: mailAudienceSchema,
    expiresInDays: z.number().int().min(1).max(365).default(30),
    /** Mail v2, P5: sent at this time instead of now (in the future, within 90 days). */
    scheduledAt: z.iso.datetime().optional(),
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

/** A page of the mailbox (mail v2): the inbox or the archive, maybe of one type, after a cursor. */
export const mailboxQuerySchema = z
  .object({
    box: z.enum(['inbox', 'archive']).default('inbox'),
    type: z.string().regex(/^[a-z]{1,20}$/).optional(),
    cursor: z.string().max(80).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  })
  .strict();
export const mailArchiveSchema = z.object({ archived: z.boolean() }).strict();

/** A sample galaxy for the panel's builder (never stored). */
export const galaxySampleSchema = z
  .object({ tier: z.enum(TIERS), trait: z.object({ key: z.enum(TRAIT_KEYS), value: z.string().min(1).max(40) }).strict().nullable().default(null), finish: z.enum(FINISHES).default('normal') })
  .strict();

/** The old shape of what a message gives (coins, dust and signals), for a page from before mail v2. */
export function legacyView(contents: MailContents): MailGifts {
  const out: MailGifts = {};
  for (const g of [...contents.items, ...contents.packs.flatMap((p) => p.items)]) {
    if (g.kind === 'currency' && (g.currency === 'coins' || g.currency === 'dust' || g.currency === 'signal')) out[g.currency] = (out[g.currency] ?? 0) + g.amount;
  }
  return out;
}

/** Whether a message is in its last `days` days. */
export function expiringSoon(expiresAt: string, now: Date, days: number): boolean {
  return Date.parse(expiresAt) - now.getTime() <= days * 86_400_000;
}

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
  /** Mail v2: its kind (its look), every gift it gives and, once claimed, what each gave. */
  type: MailType;
  contents: MailContents;
  granted: GrantedItem[] | null;
  /** The old shape (coins, dust and signals), for a page from before mail v2. */
  gifts: MailGifts;
  at: string;
  expiresAt: string;
  /** In its last days. */
  warn: boolean;
  read: boolean;
  claimed: boolean;
  archived: boolean;
}

export interface MyMailbox {
  messages: MailMessage[];
  /** What a gift's words need (mail v2, P6): the events' names (their signals) and the season's currency. */
  names?: { events: { id: string; name: string }[]; seasonCurrency: string };
  /** Over the whole mailbox, not just this page. */
  unread: number;
  unclaimed: number;
  /** The next page's cursor (none: this was the last). */
  next: string | null;
}

export interface AdminMailRow {
  id: string;
  title: string;
  body: string;
  type: MailType;
  contents: MailContents;
  /** It carried a gift only a superadmin may send. */
  big: boolean;
  /** Mail v2, P5: when it goes out (null: at once) and when it went (null: still waiting). */
  scheduledAt: string | null;
  sentAt: string | null;
  /** What its claimed gifts did, over every player: given, already owned, not given. */
  outcomes: { granted: number; owned: number; skipped: number };
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
