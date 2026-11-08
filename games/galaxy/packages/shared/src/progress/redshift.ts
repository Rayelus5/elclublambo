import { z } from 'zod';
import type { StatBonus } from '@galaxy/sim';

// The optional prestige «Corrimiento al rojo» (GDD §12.5; M7e-2, a [C] design kept small by §1.4): from a late account
// level, the Laboratorio (its nodes and its room) starts again in exchange for a small permanent bonus to experience and
// luck, and a title per rank. It never touches the collection. Few ranks, and each asks for more Laboratorio levels
// bought since the last one, so it cannot be chained or farmed.

export const DEFAULT_REDSHIFT_TITLES = ['Corrimiento I', 'Corrimiento II', 'Corrimiento III', 'Corrimiento IV', 'Corrimiento V'];

export const redshiftSchema = z
  .object({
    minLevel: z.number().int().min(1).max(99).default(25),
    maxRank: z.number().int().min(0).max(10).default(5),
    /** The Laboratorio levels (all its nodes added up) each next rank asks for: index = the rank you have now. */
    labLevels: z.array(z.number().int().min(1).max(10_000)).min(1).max(10).default([10, 15, 20, 25, 30]),
    /** The bonus each rank adds (a stat source like the Laboratorio's, inside the §8.6 caps). */
    bonus: z.object({ xp: z.number().min(0).max(0.1).default(0.03), luck: z.number().min(0).max(0.1).default(0.02) }).strict().prefault({}),
    titles: z.array(z.string().trim().min(1).max(30)).max(10).default(DEFAULT_REDSHIFT_TITLES),
  })
  .strict()
  .refine((c) => c.labLevels.length >= c.maxRank, 'Faltan niveles de Laboratorio para algún rango');
export type RedshiftConfig = z.output<typeof redshiftSchema>;

/** The stat bonuses of a rank (none at 0). */
export function redshiftBonuses(rank: number, cfg: RedshiftConfig): StatBonus[] {
  if (rank <= 0) return [];
  return [
    ...(cfg.bonus.xp > 0 ? [{ stat: 'xp' as const, value: cfg.bonus.xp * rank }] : []),
    ...(cfg.bonus.luck > 0 ? [{ stat: 'luck' as const, value: cfg.bonus.luck * rank }] : []),
  ];
}

export interface RedshiftView {
  rank: number;
  maxRank: number;
  minLevel: number;
  level: number;
  /** All the Laboratorio's node levels added up now, and what the next rank asks for (null at the top). */
  labLevels: number;
  needed: number | null;
  /** Everything is met: the next rank can be taken now. */
  eligible: boolean;
  bonus: { xp: number; luck: number };
  next: { xp: number; luck: number; title: string | null } | null;
}
