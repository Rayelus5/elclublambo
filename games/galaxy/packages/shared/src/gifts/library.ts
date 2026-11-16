import { z } from 'zod';
import { giftListSchema, PACK_ARTS, packIdSchema } from './schema';

// The admins' library for the mail (mail v2, 2026-11-16, the owner: «biblioteca de packs»): packs of gifts with a name
// and an art, reused in any message (copied into it when it is sent), templates per message type, and how many days
// before it expires a message warns its reader. A live config key (`mail`): versions, rollback and publishing come with it.

export const MAIL_TYPES = ['announcement', 'gift', 'compensation', 'event', 'reward', 'personal'] as const;
export type AdminMailType = (typeof MAIL_TYPES)[number];
/** What the game sends on its own: a referral's gift, the shop's after-sale notes, anything else. */
export const SYSTEM_MAIL_TYPES = ['referral', 'shop', 'system'] as const;
export type MailType = AdminMailType | (typeof SYSTEM_MAIL_TYPES)[number];

const name = z.string().trim().min(1).max(40);

export const mailPackSchema = z
  .object({ id: packIdSchema, name, art: z.enum(PACK_ARTS), items: giftListSchema(30).min(1), enabled: z.boolean().default(true) })
  .strict();
export type MailPack = z.output<typeof mailPackSchema>;

export const mailTemplateSchema = z
  .object({
    id: packIdSchema,
    name,
    type: z.enum(MAIL_TYPES),
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(2000),
    items: giftListSchema(20).default([]),
    packs: z.array(packIdSchema).max(5).default([]),
    expiresInDays: z.number().int().min(1).max(365).default(30),
  })
  .strict();
export type MailTemplate = z.output<typeof mailTemplateSchema>;

const unique = <T>(list: readonly T[], key: (x: T) => string) => new Set(list.map(key)).size === list.length;

export const mailConfigSchema = z
  .object({
    packs: z.array(mailPackSchema).max(100).default([]),
    templates: z.array(mailTemplateSchema).max(100).default([]),
    /** The days before it expires when a message says «Caduca pronto». */
    warnDays: z.number().int().min(1).max(30).default(3),
  })
  .strict()
  .refine((c) => unique(c.packs, (p) => p.id), { message: 'mail_pack_twice', path: ['packs'] })
  .refine((c) => unique(c.templates, (t) => t.id), { message: 'mail_template_twice', path: ['templates'] });
export type MailConfig = z.output<typeof mailConfigSchema>;
