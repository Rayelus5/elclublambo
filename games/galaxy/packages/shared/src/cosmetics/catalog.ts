import { z } from 'zod';

// Profile cosmetics (Nov plan C2, spec §6): avatars, frames and titles a player wears on the profile and next to their
// name everywhere. The art lives in the web app and is found by id; the live config `cosmetics` names each piece, says
// how rare it is, where it comes from (everyone has the default ones, rewards are earned, shop ones are bought) and
// how to get it, so the admin can rename, retire or reword pieces without a deploy.

/** Every avatar that has art (apps/web/src/profile/art/avatars): a catalog entry must be one of these. */
export const ART_AVATARS = [
  'crew-pilot',
  'crew-navigator',
  'crew-technician',
  'crew-medic',
  'crew-cadet',
  'crew-veteran',
  'crew-scientist',
  'crew-android',
  'crew-drone',
  'crew-xeno-green',
  'crew-xeno-violet',
  'crew-cat',
  'portrait-hive',
  'portrait-glacier',
  'portrait-anemone',
  'portrait-anvil',
  'portrait-echo-core',
  'portrait-signal',
  'probe-lumen',
  'probe-bastion',
  'probe-spark',
  'static-ghost',
  'cartographer',
  'first-contact',
  'shop-nebula-queen',
  'shop-void-knight',
  'shop-star-fox',
  'shop-comet-rider',
] as const;
export type AvatarId = (typeof ART_AVATARS)[number];

/** Every frame that has art (apps/web/src/profile/art/frames). Letters only: `accounts.frame` stores it. */
export const ART_FRAMES = ['bronze', 'silver', 'gold', 'nebula', 'abyss', 'crown', 'aurora', 'circuit', 'orbit', 'frost', 'ember', 'quasar', 'prism', 'solar', 'eclipse', 'starlight'] as const;

/**
 * Probe skins (plan «banda sonora, skins, perfil y entorno», part C): four collections across the eight probes, each one
 * drawn over its probe's own shape (art/probes/paint-probes.lua → SKIN_ART in the web). Id: `skin-<probe>-<line>`.
 */
export const SKIN_PROBES = ['lumen', 'bastion', 'spark', 'sentinel', 'anchor', 'prism', 'comet', 'echo'] as const;
export type SkinProbe = (typeof SKIN_PROBES)[number];
/** Chatarra and Coral are still (won playing), Aurora and Leyenda animated (the season route and the shop). */
export const SKIN_LINES = ['chatarra', 'coral', 'aurora', 'leyenda'] as const;
export type SkinLine = (typeof SKIN_LINES)[number];
export type SkinId = `skin-${SkinProbe}-${SkinLine}`;
export const ART_SKINS = SKIN_PROBES.flatMap((p) => SKIN_LINES.map((l) => `skin-${p}-${l}` as const)) as readonly SkinId[];
/** The probe and collection of a skin id (null: not a skin with art). */
export function skinParts(id: string): { probe: SkinProbe; line: SkinLine } | null {
  if (!(ART_SKINS as readonly string[]).includes(id)) return null;
  const [, probe, line] = id.split('-') as [string, SkinProbe, SkinLine];
  return { probe, line };
}
/** How many runs with a probe give its Chatarra skin (a pilot's wear and tear). */
export const SCRAP_SKIN_RUNS = 25;

export const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];
export const COSMETIC_SOURCES = ['default', 'reward', 'shop'] as const;
export type CosmeticSource = (typeof COSMETIC_SOURCES)[number];
/** How a title is written: plain, a moving shine, an aurora gradient, a flare (the last three for rare titles). */
export const TITLE_STYLES = ['plain', 'shine', 'aurora', 'flare'] as const;
export type TitleStyle = (typeof TITLE_STYLES)[number];

/** The portrait a Núcleo gives the first time it falls (any of its forms): `portrait-<form 1 id>`. */
export function portraitFor(boss: string): AvatarId | null {
  const id = `portrait-${boss}`;
  return (ART_AVATARS as readonly string[]).includes(id) ? (id as AvatarId) : null;
}

const name = z.string().trim().min(1).max(40);
const hint = z.string().trim().min(1).max(120);
export const titleText = z.string().trim().min(1).max(30);
const base = { name, rarity: z.enum(RARITIES), source: z.enum(COSMETIC_SOURCES), hint, enabled: z.boolean().default(true) };
const avatarItem = z.object({ id: z.enum(ART_AVATARS), ...base, animated: z.boolean().default(false) }).strict();
const frameItem = z.object({ id: z.enum(ART_FRAMES), ...base, animated: z.boolean().default(false) }).strict();
const skinItem = z.object({ id: z.enum(ART_SKINS as [SkinId, ...SkinId[]]), ...base, animated: z.boolean().default(false) }).strict();
const titleItem = z.object({ text: titleText, rarity: z.enum(RARITIES), source: z.enum(COSMETIC_SOURCES), hint, style: z.enum(TITLE_STYLES).default('plain'), enabled: z.boolean().default(true) }).strict();
export type AvatarItem = z.output<typeof avatarItem>;
export type FrameItem = z.output<typeof frameItem>;
export type TitleItem = z.output<typeof titleItem>;
export type SkinItem = z.output<typeof skinItem>;

const A = (id: AvatarId, name: string, rarity: Rarity, source: CosmeticSource, hint: string, animated = false): AvatarItem => ({ id, name, rarity, source, hint, enabled: true, animated });
const F = (id: (typeof ART_FRAMES)[number], name: string, rarity: Rarity, source: CosmeticSource, hint: string, animated = false): FrameItem => ({ id, name, rarity, source, hint, enabled: true, animated });
const S = (id: SkinId, name: string, rarity: Rarity, hint: string, source: CosmeticSource = 'reward', animated = false): SkinItem => ({ id, name, rarity, source, hint, enabled: true, animated });
const AURORA_HINT = 'Ruta de temporada';
const T = (text: string, rarity: Rarity, source: CosmeticSource, hint: string, style: TitleStyle): TitleItem => ({ text, rarity, source, hint, style, enabled: true });

const DEFAULT_HINT = 'De serie: es tuyo desde el primer día';
const SHOP_HINT = 'Exclusivo de la tienda, en la pestaña Estilo';

/** The launch set (owner: «lote mediano»). Titles earned by playing need no entry: they show plain unless listed. */
export const DEFAULT_COSMETICS = {
  avatars: [
    A('crew-pilot', 'Piloto', 'common', 'default', DEFAULT_HINT),
    A('crew-navigator', 'Navegante', 'common', 'default', DEFAULT_HINT),
    A('crew-technician', 'Técnica', 'common', 'default', DEFAULT_HINT),
    A('crew-medic', 'Médica', 'common', 'default', DEFAULT_HINT),
    A('crew-cadet', 'Cadete', 'common', 'default', DEFAULT_HINT),
    A('crew-veteran', 'Veterano', 'common', 'default', DEFAULT_HINT),
    A('crew-scientist', 'Científica', 'common', 'default', DEFAULT_HINT),
    A('crew-android', 'Androide', 'common', 'default', DEFAULT_HINT),
    A('crew-drone', 'Dron', 'common', 'default', DEFAULT_HINT),
    A('crew-xeno-green', 'Xeno verde', 'common', 'default', DEFAULT_HINT),
    A('crew-xeno-violet', 'Xeno violeta', 'common', 'default', DEFAULT_HINT),
    A('crew-cat', 'Gato de a bordo', 'common', 'default', DEFAULT_HINT),
    A('portrait-hive', 'La Colmena Rota', 'epic', 'reward', 'Vence a la Colmena Rota por primera vez'),
    A('portrait-glacier', 'La Madre Glaciar', 'epic', 'reward', 'Vence a la Madre Glaciar por primera vez'),
    A('portrait-anemone', 'La Anémona Rey', 'epic', 'reward', 'Vence a la Anémona Rey por primera vez'),
    A('portrait-anvil', 'El Yunque', 'epic', 'reward', 'Vence al Yunque por primera vez'),
    A('portrait-echo-core', 'El Eco Profundo', 'legendary', 'reward', 'Vence al Eco Profundo por primera vez'),
    A('portrait-signal', 'La Señal', 'legendary', 'reward', 'Vence a la Señal en la Fisura de su temporada'),
    A('probe-lumen', 'Lumen', 'rare', 'reward', 'Logro «Primer despegue»'),
    A('probe-bastion', 'Bastión', 'rare', 'reward', 'Logro «Siempre vuelvo»'),
    A('probe-spark', 'Chispa', 'rare', 'reward', 'Logro «Exterminador»'),
    A('static-ghost', 'Fantasma de estática', 'epic', 'reward', 'Logro «Azote de Núcleos»'),
    A('cartographer', 'La Cartógrafa', 'epic', 'reward', 'Completa la mitad del Catálogo'),
    A('first-contact', 'Primer contacto', 'legendary', 'reward', 'Se gana en un evento'),
    A('shop-nebula-queen', 'Reina de la nebulosa', 'legendary', 'shop', SHOP_HINT, true),
    A('shop-void-knight', 'Caballero del vacío', 'legendary', 'shop', SHOP_HINT, true),
    A('shop-star-fox', 'Zorro estelar', 'epic', 'shop', SHOP_HINT),
    A('shop-comet-rider', 'Jinete del cometa', 'epic', 'shop', SHOP_HINT),
  ],
  frames: [
    F('bronze', 'Bronce', 'common', 'reward', 'Logro «Primera legendaria»'),
    F('silver', 'Plata', 'common', 'reward', 'Logro «Veterano»'),
    F('gold', 'Oro', 'rare', 'reward', 'Completa el Catálogo'),
    F('nebula', 'Nebulosa', 'epic', 'reward', 'Ruta de temporada', true),
    F('abyss', 'Abismo', 'epic', 'reward', 'Logro «Abismo»', true),
    F('crown', 'Corona', 'legendary', 'reward', 'Podio de la temporada', true),
    F('aurora', 'Aurora', 'epic', 'reward', 'Completa tres cuartos del Catálogo', true),
    F('circuit', 'Circuito', 'rare', 'reward', 'Logro «Alquimista»'),
    F('orbit', 'Órbita', 'rare', 'reward', 'Logro «Escuadrón»'),
    F('frost', 'Escarcha', 'rare', 'reward', 'Logro «Ángel de la guarda»'),
    F('ember', 'Ascua', 'epic', 'reward', 'Logro «Purgador»', true),
    F('quasar', 'Cuásar', 'legendary', 'reward', 'Logro «Leyenda del ECN»', true),
    F('prism', 'Prisma', 'legendary', 'shop', SHOP_HINT, true),
    F('solar', 'Corona solar', 'epic', 'shop', SHOP_HINT, true),
    F('eclipse', 'Eclipse', 'rare', 'shop', SHOP_HINT),
    F('starlight', 'Luz de estrellas', 'rare', 'shop', SHOP_HINT),
  ],
  titles: [
    T('Mecenas estelar', 'legendary', 'shop', SHOP_HINT, 'aurora'),
    T('Pionero del ECN', 'epic', 'shop', SHOP_HINT, 'flare'),
    T('Guardián de la nebulosa', 'rare', 'shop', SHOP_HINT, 'shine'),
    T('Viajero del vacío', 'rare', 'shop', SHOP_HINT, 'plain'),
    T('Leyenda del ECN', 'legendary', 'reward', 'Logro «Leyenda del ECN»', 'shine'),
    T('Guardián del cielo', 'legendary', 'reward', 'Completa el Catálogo', 'aurora'),
  ],
  skins: [
    S('skin-lumen-chatarra', 'Lumen de chatarra', 'common', `${SCRAP_SKIN_RUNS} incursiones con Lumen`),
    S('skin-bastion-chatarra', 'Bastión de chatarra', 'common', `${SCRAP_SKIN_RUNS} incursiones con Bastión`),
    S('skin-spark-chatarra', 'Chispa de chatarra', 'common', `${SCRAP_SKIN_RUNS} incursiones con Chispa`),
    S('skin-sentinel-chatarra', 'Vigía de chatarra', 'common', `${SCRAP_SKIN_RUNS} incursiones con Vigía`),
    S('skin-anchor-chatarra', 'Áncora de chatarra', 'common', `${SCRAP_SKIN_RUNS} incursiones con Áncora`),
    S('skin-prism-chatarra', 'Prisma de chatarra', 'common', `${SCRAP_SKIN_RUNS} incursiones con Prisma`),
    S('skin-comet-chatarra', 'Cometa de chatarra', 'common', `${SCRAP_SKIN_RUNS} incursiones con Cometa`),
    S('skin-echo-chatarra', 'Eco de chatarra', 'common', `${SCRAP_SKIN_RUNS} incursiones con Eco`),
    S('skin-lumen-coral', 'Lumen de coral', 'rare', 'Se gana en eventos y en el Catálogo'),
    S('skin-bastion-coral', 'Bastión de coral', 'rare', 'Se gana en eventos y en el Catálogo'),
    S('skin-spark-coral', 'Chispa de coral', 'rare', 'Se gana en eventos y en el Catálogo'),
    S('skin-sentinel-coral', 'Vigía de coral', 'rare', 'Se gana en eventos y en el Catálogo'),
    S('skin-anchor-coral', 'Áncora de coral', 'rare', 'Se gana en eventos y en el Catálogo'),
    S('skin-prism-coral', 'Prisma de coral', 'rare', 'Se gana en eventos y en el Catálogo'),
    S('skin-comet-coral', 'Cometa de coral', 'rare', 'Se gana en eventos y en el Catálogo'),
    S('skin-echo-coral', 'Eco de coral', 'rare', 'Se gana en eventos y en el Catálogo'),
    // Part C2: the animated ones. Aurora rides the season route; Leyenda is the shop's.
    S('skin-lumen-aurora', 'Lumen aurora', 'epic', AURORA_HINT, 'reward', true),
    S('skin-bastion-aurora', 'Bastión aurora', 'epic', AURORA_HINT, 'reward', true),
    S('skin-spark-aurora', 'Chispa aurora', 'epic', AURORA_HINT, 'reward', true),
    S('skin-sentinel-aurora', 'Vigía aurora', 'epic', AURORA_HINT, 'reward', true),
    S('skin-anchor-aurora', 'Áncora aurora', 'epic', AURORA_HINT, 'reward', true),
    S('skin-prism-aurora', 'Prisma aurora', 'epic', AURORA_HINT, 'reward', true),
    S('skin-comet-aurora', 'Cometa aurora', 'epic', AURORA_HINT, 'reward', true),
    S('skin-echo-aurora', 'Eco aurora', 'epic', AURORA_HINT, 'reward', true),
    S('skin-lumen-leyenda', 'Lumen leyenda', 'legendary', SHOP_HINT, 'shop', true),
    S('skin-bastion-leyenda', 'Bastión leyenda', 'legendary', SHOP_HINT, 'shop', true),
    S('skin-spark-leyenda', 'Chispa leyenda', 'legendary', SHOP_HINT, 'shop', true),
    S('skin-sentinel-leyenda', 'Vigía leyenda', 'legendary', SHOP_HINT, 'shop', true),
    S('skin-anchor-leyenda', 'Áncora leyenda', 'legendary', SHOP_HINT, 'shop', true),
    S('skin-prism-leyenda', 'Prisma leyenda', 'legendary', SHOP_HINT, 'shop', true),
    S('skin-comet-leyenda', 'Cometa leyenda', 'legendary', SHOP_HINT, 'shop', true),
    S('skin-echo-leyenda', 'Eco leyenda', 'legendary', SHOP_HINT, 'shop', true),
  ],
} satisfies { avatars: AvatarItem[]; frames: FrameItem[]; titles: TitleItem[]; skins: SkinItem[] };

const unique = <T>(list: readonly T[], key: (x: T) => string) => new Set(list.map(key)).size === list.length;

export const cosmeticsConfigSchema = z
  .object({
    avatars: z.array(avatarItem).max(ART_AVATARS.length).default(DEFAULT_COSMETICS.avatars),
    frames: z.array(frameItem).max(ART_FRAMES.length).default(DEFAULT_COSMETICS.frames),
    titles: z.array(titleItem).max(200).default(DEFAULT_COSMETICS.titles),
    skins: z.array(skinItem).max(ART_SKINS.length).default(DEFAULT_COSMETICS.skins),
  })
  .strict()
  .refine((c) => unique(c.avatars, (a) => a.id), { message: 'cosmetics_avatar_twice', path: ['avatars'] })
  .refine((c) => unique(c.frames, (f) => f.id), { message: 'cosmetics_frame_twice', path: ['frames'] })
  .refine((c) => unique(c.titles, (t) => t.text), { message: 'cosmetics_title_twice', path: ['titles'] })
  .refine((c) => unique(c.skins, (k) => k.id), { message: 'cosmetics_skin_twice', path: ['skins'] });
export type CosmeticsConfig = z.output<typeof cosmeticsConfigSchema>;

/** How many galaxies the title screen's sky may show (plan «escáner pro», part E). */
export const BACKDROP_MAX = 12;

/** A galaxy fit for the sky: not the paper-white Antimatter palette, not the Anomaly glitch (a broken screen). */
export function backdropEligible(traits: Readonly<Record<string, string | undefined>>): boolean {
  return traits['palette'] !== 'antimatter' && traits['phenomenon'] !== 'anomaly';
}

/** What «Personalizar» saves: only the fields sent change; null takes the piece off (the avatar: back to «Tu firma»). */
export const profileCosmeticsSchema = z
  .object({
    avatar: z.string().regex(/^[a-z0-9-]{1,32}$/).nullable().optional(),
    frame: z.string().regex(/^[a-z]{1,16}$/).nullable().optional(),
    title: titleText.nullable().optional(),
    banner: z.uuid().nullable().optional(),
    /** The sky's galaxies (empty: the rarest, as before). */
    backdrop: z
      .array(z.uuid())
      .max(BACKDROP_MAX)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'backdrop_twice' })
      .optional(),
  })
  .strict();
export type ProfileCosmeticsRequest = z.output<typeof profileCosmeticsSchema>;
