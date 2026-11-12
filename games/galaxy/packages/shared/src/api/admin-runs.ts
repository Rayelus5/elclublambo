import type { CoopRules, Content, RelicInput, StatBonus } from '@galaxy/sim';
import { z } from 'zod';
import { usernameSchema } from '../account';
import type { CoopPlayer } from './coop';

// The panel's runs (GDD §16.2, §16.6; M6d-3), for admins: a list of every run, newest first, a run's replay (its start
// rebuilt from what the server kept, and its recorded inputs) and marking it as suspicious or not.

export const ADMIN_RUNS_PAGE = 50;

export const adminRunsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    player: usernameSchema.optional(),
    suspicious: z.enum(['true', 'false']).optional(),
    /** Only group runs (true) or only solo ones (false), phase 7. */
    group: z.enum(['true', 'false']).optional(),
  })
  .strict();
export const adminRunParamSchema = z.object({ id: z.string().uuid() }).strict();
export const adminRunMarkSchema = z.object({ suspicious: z.boolean(), reason: z.string().trim().min(3).max(300) }).strict();
export type AdminRunMark = z.infer<typeof adminRunMarkSchema>;

export interface AdminRunRow {
  id: string;
  player: string;
  startedAt: string;
  sector: string;
  probe: string;
  /** null while the run has not finished (it may never). */
  outcome: 'extracted' | 'died' | 'abandoned' | null;
  seconds: number | null;
  depth: number | null;
  kills: number | null;
  suspicious: boolean;
  flags: string[];
  /** A group run (phase 7): how many started it; null for a solo run. */
  party: number | null;
}

export interface AdminRunClaim {
  ticks: number;
  depth: number;
  kills: number;
  bossKills: number;
  level: number;
}

export interface AdminRunList {
  runs: AdminRunRow[];
  total: number;
  page: number;
  pages: number;
}

export interface AdminRunReplay {
  run: AdminRunRow & {
    finishedAt: string | null;
    ticks: number | null;
    level: number | null;
    bossKills: number | null;
    hash: string | null;
    simVersion: string;
    contentVersion: number;
    /** The figures the client sent at the finish (the kept ones may be clipped to real time); null before M6d-3. */
    claimed: AdminRunClaim | null;
  };
  /** The run's content version is no longer in the history (or no longer parses): `start.content` is the defaults. */
  contentFallback: boolean;
  /** The run's start as the server snapshotted it, with the content of the version it started with. */
  start: { seed: string; sector: string; probe: string; relics: RelicInput[]; bonuses: StatBonus[]; variant: string | null; anomaly: string | null; skin?: string | null; content: Content };
  /** The recorded inputs (packages/sim encodeLog, base64); null for a run that never finished. A group run's are the
   * whole group's, kept once for the run. */
  inputs: string | null;
  /**
   * A group run (multiplayer plan, phase 6c): the group's start (`start.seed`, sector and anomaly are its) with every
   * player, its rules, the slot of the player looked at, and the run's own end (ticks, depth, hash) to replay to and
   * check against. Null for a solo run.
   */
  coop: { slot: number; players: CoopPlayer[]; rules: CoopRules; ticks: number | null; depth: number | null; hash: string | null } | null;
}
