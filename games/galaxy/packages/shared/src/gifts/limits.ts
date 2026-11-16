import { z } from 'zod';
import { FINISHES, TIERS } from '../gacha/types';
import { COSMETIC_SOURCES } from '../cosmetics/catalog';

// What makes a gift big (mail v2, 2026-11-16, the owner: «solo superadmin»): any admin sends the rest with their
// password; a gift past these limits only a superadmin. The key itself only a superadmin publishes, or an admin could
// raise their own limit.

const n = z.number().int().min(0).max(100_000_000);

export const mailLimitsSchema = z
  .object({
    /** A galaxy of this tier or better. */
    galaxyTier: z.enum(TIERS).default('legendary'),
    /** A galaxy with one of these finishes. */
    finishes: z.array(z.enum(FINISHES)).default(['prismatic', 'braille', 'corrupt', 'rift']),
    /** A cosmetic piece from these sources (the shop's are sold for money). */
    cosmeticSources: z.array(z.enum(COSMETIC_SOURCES)).default(['shop']),
    /** More of a currency than this for each player (season currencies count as `season`). */
    currency: z
      .object({ coins: n, dust: n, signal: n, material: n, components: n, season: n })
      .strict()
      .default({ coins: 50_000, dust: 20_000, signal: 50, material: 2_000, components: 500, season: 5_000 }),
    /** More account XP or season points than this for each player. */
    xp: n.default(10_000),
    seasonPoints: n.default(2_000),
    /** Unlocking a probe. */
    probes: z.boolean().default(true),
    /** Any gift to more players than this (null: no limit). */
    recipients: z.number().int().min(1).max(10_000_000).nullable().default(null),
  })
  .strict();
export type MailLimits = z.output<typeof mailLimitsSchema>;
