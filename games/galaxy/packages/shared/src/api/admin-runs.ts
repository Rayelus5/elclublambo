import type { Content, RelicInput, StatBonus } from '@galaxy/sim';
import { z } from 'zod';
import { usernameSchema } from '../account';

// The panel's runs (GDD §16.2, §16.6; M6d-3), for admins: a list of every run, newest first, a run's replay (its start
// rebuilt from what the server kept, and its recorded inputs) and marking it as suspicious or not.

export const ADMIN_RUNS_PAGE = 50;

export const adminRunsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    player: usernameSchema.optional(),
    suspicious: z.enum(['true', 'false']).optional(),
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
  };
  /** The run's start as the server snapshotted it, with the content of the version it started with. */
  start: { seed: string; sector: string; probe: string; relics: RelicInput[]; bonuses: StatBonus[]; variant: string | null; content: Content };
  /** The recorded inputs (packages/sim encodeLog, base64); null for a run that never finished. */
  inputs: string | null;
}
