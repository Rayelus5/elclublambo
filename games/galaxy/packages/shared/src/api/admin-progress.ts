import { TRAITS } from '@galaxy/engine';
import { z } from 'zod';

// A player's progress edited from the panel (GDD §16.2 «Editar todo»; M6d-4): the gacha luck counters, a probe's level
// and starting weapon, probes unlocked by an admin, a station room's level, a Laboratorio node's level and season
// points. Each change carries a reason; one that takes something away (a lower level, a locked probe, points taken
// away) also the admin's password.

const reason = z.string().trim().min(3).max(300);
const password = z.string().min(1).max(200).optional();
const id = z.string().regex(/^[a-z0-9-]{1,32}$/);

/** The galaxy types the engine draws (a galaxy can be given of one of them). */
export const GALAXY_TYPES = TRAITS.traits.galaxy_type.values.map((v) => v.value) as [string, ...string[]];

export const adminGachaLuckSchema = z
  .object({ group: id, sinceLegendary: z.number().int().min(0).max(10_000), sinceFeatured: z.number().int().min(0).max(10_000), welcome: z.boolean(), reason, password })
  .strict();
export const adminProbeSchema = z.object({ probe: id, level: z.number().int().min(1).max(20), variant: id.nullable(), reason, password }).strict();
export const adminProbeGrantSchema = z.object({ probe: id, granted: z.boolean(), reason, password }).strict();
export const adminRoomSchema = z.object({ room: id, level: z.number().int().min(0).max(10), reason, password }).strict();
export const adminLabNodeSchema = z.object({ node: id, level: z.number().int().min(0).max(10), reason, password }).strict();
export const adminSeasonSchema = z
  .object({ points: z.number().int().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, 'zero_points'), reason, password })
  .strict();

export type AdminGachaLuck = z.infer<typeof adminGachaLuckSchema>;
export type AdminProbeEdit = z.infer<typeof adminProbeSchema>;
export type AdminProbeGrant = z.infer<typeof adminProbeGrantSchema>;
export type AdminRoomEdit = z.infer<typeof adminRoomSchema>;
export type AdminLabNodeEdit = z.infer<typeof adminLabNodeSchema>;
export type AdminSeasonEdit = z.infer<typeof adminSeasonSchema>;

export interface AdminProgress {
  /** One row per pity group the account has pulled in (the standard one always). */
  gacha: { group: string; sinceLegendary: number; sinceFeatured: number; welcome: boolean; totalPulls: number }[];
  /** Every probe: its level (1 without a row), its stored variant (null: the base weapon) and how it is unlocked. */
  probes: { probe: string; name: string; level: number; maxLevel: number; variant: string | null; variants: { id: string; name: string; unlockAt: number }[]; unlocked: boolean; granted: boolean }[];
  /** The rooms that have levels (the machines). */
  rooms: { room: string; level: number; maxLevel: number }[];
  /** Every Laboratorio node, 0 when the account has none of it. */
  lab: { node: string; name: string; level: number; max: number }[];
  /** The season open now: the account's General points (runs and adjustments) and the adjustments alone; null between seasons. */
  season: { id: string; name: string; points: number; adjustments: number } | null;
}
