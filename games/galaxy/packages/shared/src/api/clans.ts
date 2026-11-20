import type { PlayerLook } from './cosmetics';
import { z } from 'zod';
import { usernameSchema } from '../account';
import { CLAN_COLORS, CLAN_EMBLEMS, type ClanColor, type ClanEmblem, type ClanRole } from '../clans/rules';

// The clans' API (GDD §14.3; M5b-1). A clan's public view shows its members' names, roles, levels and season points,
// nothing else about them; the requests to join are seen only by the leader and the officers.

/**
 * 3–24 characters (counted as characters, as the database does): Latin letters (accents and ñ included, no look-alikes
 * from other scripts) and digits, words separated by single spaces.
 */
export const clanName = z
  .string()
  .refine((s) => [...s].length >= 3 && [...s].length <= 24, 'clan_name_length')
  .pipe(z.string().regex(/^[\p{Script=Latin}0-9]+(?: [\p{Script=Latin}0-9]+)*$/u));
/** 2–4 letters or digits, kept in capitals. */
export const clanTag = z
  .string()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{2,4}$/));

export const clanCreateSchema = z
  .object({
    name: clanName,
    tag: clanTag,
    description: z.string().max(140).default(''),
    emblem: z.enum(CLAN_EMBLEMS),
    color: z.enum(CLAN_COLORS),
    open: z.boolean().default(true),
  })
  .strict();
export type ClanCreate = z.infer<typeof clanCreateSchema>;

export const clanEditSchema = z
  .object({
    description: z.string().max(140).optional(),
    emblem: z.enum(CLAN_EMBLEMS).optional(),
    color: z.enum(CLAN_COLORS).optional(),
    open: z.boolean().optional(),
  })
  .strict();
export type ClanEdit = z.infer<typeof clanEditSchema>;

export const clanTagParamSchema = z.object({ tag: clanTag }).strict();
export const clanMemberParamSchema = z.object({ tag: clanTag, username: usernameSchema }).strict();
export const clanSearchSchema = z.object({ q: z.string().max(24).optional() }).strict();

export interface ClanCard {
  tag: string;
  name: string;
  emblem: ClanEmblem;
  color: ClanColor;
  open: boolean;
  members: number;
  maxMembers: number;
  /** The season score of its members. */
  score: number;
}

export interface ClanMember extends PlayerLook {
  username: string;
  role: ClanRole;
  level: number;
  /** This season's points. */
  points: number;
  joinedAt: string;
}

export interface ClanView {
  tag: string;
  name: string;
  description: string;
  emblem: ClanEmblem;
  color: ClanColor;
  open: boolean;
  createdAt: string;
  maxMembers: number;
  /** How long a kicked member waits to come back (live `clans.kickHours`). */
  kickHours: number;
  members: ClanMember[];
  score: number;
  /** Its place among clans this season, or null without points. */
  rank: number | null;
  /** Who asked to join (leader and officers only). */
  requests?: string[];
  /** The viewer in this clan: their role, or whether they asked to join; null when neither. */
  me: { role: ClanRole } | { requested: true } | null;
}

export type MyClan = ClanView | null;

/** The clans list, with the rules a screen needs to offer «Crear clan» (live config `clans`). */
export interface ClanList {
  clans: ClanCard[];
  rules: { maxMembers: number; createCost: { coins: number }; minLevel: number };
}
