import { z } from 'zod';
import type { ConfigValue } from '../config/registry';
import type { Mission } from '../progress/missions';
import type { SeasonRules, SeasonState } from '../progress/season-record';

// The panel's «Temporadas» (plan «temporadas como fichas», 2026-11-21): every season as a record, drafts too, with what
// an admin does to them. Saving a draft needs only a reason (a draft is invisible); scheduling, unscheduling and moving
// an end are publishing, so they ask for the admin's password as well.

/** A season as the panel shows it. */
export interface AdminSeason {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  state: SeasonState;
  /** Open right now (scheduled, between its dates). */
  open: boolean;
  version: number;
  rules: SeasonRules;
  route: ConfigValue<'seasonRoute'>;
  missions: Mission[];
  lab: ConfigValue<'lab'>['season'];
}

/** Something about the calendar an admin should know (no season for some days, none after the current one…). */
export type SeasonCalendarWarning =
  | { kind: 'gap'; after: string; before: string; from: string; to: string }
  | { kind: 'nothing_next'; after: string; endsAt: string };

export interface AdminSeasonList {
  seasons: AdminSeason[];
  now: string;
  warnings: SeasonCalendarWarning[];
}

export interface SeasonIssue {
  path: string;
  message: string;
}

const reason = z.string().trim().min(3).max(500);
const password = z.string().min(1).max(200);

export const seasonSaveBodySchema = z.object({ record: z.unknown(), reason });
export const seasonValidateBodySchema = z.object({ record: z.unknown() });
export const seasonActionBodySchema = z.object({ reason, password });
export const seasonExtendBodySchema = z.object({ endsAt: z.iso.datetime(), moveNext: z.boolean().default(false), reason, password });
export const seasonDeleteBodySchema = z.object({ reason });
export const seasonIdParamsSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{1,32}$/) });

/** The calendar's warnings for a list of seasons (scheduled and closed ones only; drafts do not count). */
export function seasonCalendarWarnings(list: readonly { id: string; state: SeasonState; startsAt: string; endsAt: string }[], now: number, soonDays = 14): SeasonCalendarWarning[] {
  const counted = list.filter((s) => s.state !== 'draft').sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const out: SeasonCalendarWarning[] = [];
  for (let i = 1; i < counted.length; i++) {
    const prev = counted[i - 1]!;
    const next = counted[i]!;
    // Gaps that are over do not matter any more.
    if (Date.parse(next.startsAt) > Date.parse(prev.endsAt) && Date.parse(next.startsAt) > now) out.push({ kind: 'gap', after: prev.id, before: next.id, from: prev.endsAt, to: next.startsAt });
  }
  const last = counted.at(-1);
  if (last && last.state === 'scheduled' && Date.parse(last.endsAt) > now && Date.parse(last.endsAt) - now < soonDays * 86_400_000) out.push({ kind: 'nothing_next', after: last.id, endsAt: last.endsAt });
  return out;
}
