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

export const modChannelQuerySchema = z.object({ channel: channelKey, before: z.string().regex(/^\d{1,18}$/).optional() }).strict();
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
  /** Hidden by a moderator (by whom, if the account still exists) or by reports. */
  hidden: { reason: 'moderator' | 'reports'; by: string | null; at: string } | null;
  reports: number;
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
