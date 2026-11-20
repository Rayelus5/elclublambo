import { z } from 'zod';
import { usernameSchema } from '../account';
import type { ClanRole } from '../clans/rules';
import { clanName, clanTag, clanTagParamSchema } from './clans';

// Moderation (GDD §16.4; M6c-1). Staff (moderators, admins and superadmins with TOTP) watch the chats live, hide and
// restore messages, work the report queue and mute accounts; admins also rename, empty and dissolve clans. Every
// change carries a reason for the audit; dissolving a clan also carries the admin's password.

/** How many messages a page of the live view holds. */
export const MOD_PAGE_SIZE = 100;

const reason = z.string().trim().min(3).max(300);
const password = z.string().min(1).max(200);

/** A chat as the tables key it: 'global', 'clan:<id>' or 'room:<id>' (a group room's, phase 6c). */
const channelKey = z.union([z.literal('global'), z.string().regex(/^(clan|room):[0-9a-f-]{36}$/)]);

const messageId = z.string().regex(/^\d{1,18}$/);
const iso = z.iso.datetime({ offset: true });
/** Which messages: all, the ones players see, or the hidden ones. */
export const MOD_STATES = ['all', 'visible', 'hidden'] as const;
export type ModState = (typeof MOD_STATES)[number];

/**
 * The panel's search over every chat (the owner's chat asks, 2026-11-14), newest first, `before` pages back: a channel
 * (or all of them), words in the text (3 letters at least, any part of a word), an author, hidden or visible,
 * reported, and a window of dates.
 */
export const modChannelQuerySchema = z
  .object({
    channel: z.union([z.literal('all'), channelKey]).default('all'),
    q: z.string().trim().min(3).max(100).optional(),
    author: usernameSchema.optional(),
    state: z.enum(MOD_STATES).default('all'),
    reported: z.literal('1').optional(),
    from: iso.optional(),
    to: iso.optional(),
    before: messageId.optional(),
  })
  .strict();
export type ModSearch = z.input<typeof modChannelQuerySchema>;

/** Hiding several messages at once (100 at most). */
export const modHideManySchema = z.object({ ids: z.array(messageId).min(1).max(100), reason }).strict();
/** Hiding what an account wrote lately: the last hour, day or week (500 messages at most). */
export const MOD_AUTHOR_WINDOWS = [1, 24, 168] as const;
export const modAuthorHideSchema = z.object({ hours: z.union([z.literal(1), z.literal(24), z.literal(168)]), reason }).strict();
/** Hiding a message and muting its author in one go. */
export const modHideMuteSchema = z.object({ minutes: z.number().int().min(1).max(43_200), reason: z.string().trim().min(3).max(140) }).strict();
export const modReasonSchema = z.object({ reason }).strict();
export const MOD_REPORTS_PAGE_SIZE = 50;
export const modReportsQuerySchema = z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1) }).strict();
export const modResolveSchema = z.object({ outcome: z.enum(['hidden', 'kept']), reason }).strict();
export type ModOutcome = z.infer<typeof modResolveSchema>['outcome'];
/** The chat_mutes table keeps 140 characters of reason. */
export const modMuteSchema = z.object({ username: usernameSchema, minutes: z.number().int().min(1).max(43_200), reason: z.string().trim().min(3).max(140) }).strict();
export const modUsernameParamSchema = z.object({ username: usernameSchema }).strict();

export const adminClanQuerySchema = z.object({ q: z.string().trim().max(64).optional() }).strict();
export const adminClanTagParamSchema = clanTagParamSchema;
export const adminClanEditSchema = z
  .object({ name: clanName.optional(), tag: clanTag.optional(), description: z.string().max(140).optional(), reason })
  .strict()
  .refine((v) => v.name !== undefined || v.tag !== undefined || v.description !== undefined, 'clan_edit_empty');
export type AdminClanEdit = z.infer<typeof adminClanEditSchema>;
export const adminClanMemberSchema = z.object({ username: usernameSchema, reason }).strict();
export const adminClanDissolveSchema = z.object({ reason, password }).strict();

/** A chat that can be watched: the global one, and each clan's with recent messages. */
export interface ModChannel {
  key: string;
  label: string;
  /** Its last message (ISO), null for a quiet global chat. */
  lastAt: string | null;
}

export interface ModMessage {
  id: string;
  channel: string;
  author: string;
  body: string;
  at: string;
  /** Hidden by a moderator (by whom, if the account still exists), by reports, or deleted (never shown again). */
  hidden: { reason: 'moderator' | 'reports' | 'deleted'; by: string | null; at: string } | null;
  /** Its reports, and those waiting since its last review. */
  reports: number;
  pending: number;
}

/** A message waiting for a moderator: its reports since its last review. */
export interface ModReport {
  message: ModMessage;
  /** The reasons written, newest first (empty ones left out). */
  reasons: string[];
  pending: number;
  firstAt: string;
  lastAt: string;
}

/** The queue a page at a time (50), the message reported most recently first. */
export interface ModReportPage {
  reports: ModReport[];
  /** How many messages are waiting. */
  total: number;
  page: number;
  pages: number;
}

export interface ModMute {
  username: string;
  until: string;
  reason: string;
  by: string | null;
}

export interface AdminClanRow {
  tag: string;
  name: string;
  members: number;
  leader: string | null;
  createdAt: string;
}

export interface AdminClan extends AdminClanRow {
  description: string;
  emblem: string;
  color: string;
  open: boolean;
  roster: { username: string; role: ClanRole; joinedAt: string }[];
}

/** Why a teammate of a group run is reported (multiplayer plan, phase 7). */
export const PLAYER_REPORT_REASONS = ['idle', 'griefing', 'cheating', 'abuse', 'other'] as const;
export type PlayerReportReason = (typeof PLAYER_REPORT_REASONS)[number];
export const playerReportSchema = z.object({ username: usernameSchema, reason: z.enum(PLAYER_REPORT_REASONS), note: z.string().trim().max(300).optional() }).strict();
/** A review: what was decided and why (the panel's dialogs always send it as `reason`). */
export const playerReportReviewSchema = z.object({ outcome: z.enum(['dismissed', 'actioned']), reason: z.string().trim().min(3).max(300) }).strict();

/** A report waiting for the staff: who, whom, why, and the run (with the reported player's own row, to replay it). */
export interface PlayerReport {
  id: string;
  reporter: string;
  reported: string;
  reason: PlayerReportReason;
  note: string | null;
  at: string;
  coopRunId: string;
  reportedRunId: string | null;
  sector: string;
}

export interface PlayerReportPage {
  reports: PlayerReport[];
  total: number;
  page: number;
  pages: number;
}
