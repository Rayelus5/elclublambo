import { z } from 'zod';
import { currencySchema, FINISHES, TIERS, TRAIT_KEYS } from '../gacha/types';

// Gifts of every kind (mail v2, 2026-11-16): what an admin can give a player — any resource, a cosmetic piece, galaxies
// (a tier, a finish and maybe one trait), a probe, account XP or season points. One shape for the mail and, later, for
// any system that pays rewards (grantGifts on the server).

/** Every currency a gift can carry: the wallet's (event signals included) and a season's own (`season:<id>`). */
export const giftCurrencySchema = z.union([currencySchema, z.string().regex(/^season:[a-z0-9-]{1,32}$/) as z.ZodType<`season:${string}`>]);
export type GiftCurrency = z.output<typeof giftCurrencySchema>;

export const COSMETIC_PIECES = ['avatar', 'frame', 'title', 'skin'] as const;
export type CosmeticPiece = (typeof COSMETIC_PIECES)[number];

const amount = (max: number) => z.number().int().min(1).max(max);

export const giftSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('currency'), currency: giftCurrencySchema, amount: amount(10_000_000) }).strict(),
  z.object({ kind: z.literal('cosmetic'), piece: z.enum(COSMETIC_PIECES), id: z.string().trim().min(1).max(60) }).strict(),
  z
    .object({
      kind: z.literal('galaxy'),
      tier: z.enum(TIERS),
      finish: z.enum(FINISHES),
      /** One trait the galaxy must have (an engine trait and one of its values), or any. */
      trait: z.object({ key: z.enum(TRAIT_KEYS), value: z.string().min(1).max(40) }).strict().nullable().default(null),
      count: z.number().int().min(1).max(5).default(1),
    })
    .strict()
    // The scanner never gives a plain mythic: a gift of one carries a special finish.
    .refine((g) => !(g.tier === 'mythic' && g.finish === 'normal'), { message: 'mythic_needs_finish', path: ['finish'] }),
  z.object({ kind: z.literal('probe'), probe: z.string().regex(/^[a-z0-9-]{1,32}$/) }).strict(),
  z.object({ kind: z.literal('xp'), amount: amount(1_000_000) }).strict(),
  z.object({ kind: z.literal('seasonPoints'), amount: amount(1_000_000) }).strict(),
]);
export type Gift = z.output<typeof giftSchema>;
export type GiftKind = Gift['kind'];

/** A list of at most `max` gifts. */
export const giftListSchema = (max: number) => z.array(giftSchema).max(max);

export const packIdSchema = z.string().regex(/^[a-z0-9-]{1,32}$/);

/** The art of a pack: one of the parcels drawn for the mail. */
export const PACK_ARTS = ['parcel', 'chest', 'capsule', 'star', 'crate', 'gift'] as const;
export type PackArt = (typeof PACK_ARTS)[number];

/** A pack as it is copied into a message when it is sent (editing the library later never changes it). */
export const packCopySchema = z.object({ id: packIdSchema, name: z.string().trim().min(1).max(40), art: z.enum(PACK_ARTS), items: giftListSchema(30) }).strict();
export type PackCopy = z.output<typeof packCopySchema>;

/** What an admin sends: loose gifts and packs of the library (by id). */
export const giftBundleInputSchema = z.object({ items: giftListSchema(20).default([]), packs: z.array(packIdSchema).max(5).default([]) }).strict();
export type GiftBundleInput = z.output<typeof giftBundleInputSchema>;

/** What a message keeps (version 2): its loose gifts and the copy of its packs. */
export const mailContentsSchema = z.object({ v: z.literal(2), items: giftListSchema(20), packs: z.array(packCopySchema).max(5) }).strict();
export type MailContents = z.output<typeof mailContentsSchema>;

/** What a claim gave, gift by gift: given, already owned (a piece, a probe) or not given (and why). */
export interface GrantedItem {
  gift: Gift;
  outcome: 'granted' | 'owned' | 'skipped';
  /** The galaxies a galaxy gift made. */
  galaxies?: { id: string; name: string; tier: number; finish: string }[];
  why?: string;
}
