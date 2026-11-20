import { z } from 'zod';

// The news board (the owner, 2026-11-14: «un tablón de anuncios mucho más visual … totalmente personalizable de forma
// intuitiva desde admin»): cards in sections, each with a title, a short text, an image (one of the game's own
// gallery or one the admin uploaded) and, on most, a link into the game or out to a URL (Discord). Some cards are
// «auto»: what they say comes from the live game (the latest patch notes, the events on, the season, the multipliers,
// the Discord); the admin only places them, gives them an image and shows or hides them.

export const NEWS_SECTIONS = ['destacado', 'comunidad', 'eventos', 'novedades'] as const;
export type NewsSection = (typeof NEWS_SECTIONS)[number];

export const NEWS_KINDS = ['custom', 'auto:patch', 'auto:events', 'auto:season', 'auto:boosts', 'auto:discord'] as const;
export type NewsKind = (typeof NEWS_KINDS)[number];

/** The game's own images for the board (apps/web/src/news/art/<key>.png), drawn in its style. */
export const NEWS_GALLERY = ['comunidad', 'discord', 'temporada', 'torneo', 'evento', 'escaner', 'multiplicadores', 'notas', 'mercado', 'clanes', 'grupo', 'mitica'] as const;
export type NewsGalleryKey = (typeof NEWS_GALLERY)[number];

/** The places in the game a card can lead to (a closed list: never a typed path). */
export const NEWS_ROUTES = [
  '/escaner',
  '/incursion',
  '/incursion/grupo',
  '/coleccion',
  '/mercado',
  '/temporada',
  '/misiones',
  '/clasificacion',
  '/clanes',
  '/catalogo',
  '/tienda',
  '/laboratorio',
  '/estacion',
  '/taller',
  '/planetario',
  '/trofeos',
  '/codice',
  '/guia',
  '/notas-de-version',
] as const;
export type NewsRoute = (typeof NEWS_ROUTES)[number];

export const newsImageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('gallery'), key: z.enum(NEWS_GALLERY) }).strict(),
  z.object({ kind: z.literal('asset'), id: z.uuid() }).strict(),
]);
export type NewsImage = z.infer<typeof newsImageSchema>;

const label = z.string().trim().min(1).max(32);
export const newsLinkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('route'), to: z.enum(NEWS_ROUTES), label }).strict(),
  // Only https, and never this site's own login or admin (an outside page opens in a new tab).
  z
    .object({ kind: z.literal('url'), href: z.url({ protocol: /^https$/ }).max(300), label })
    .strict(),
]);
export type NewsLink = z.infer<typeof newsLinkSchema>;

const iso = z.iso.datetime({ offset: true });

/** What the admin writes for a card (an auto card's title and text are its own, and stay empty). */
export const newsPostInputSchema = z
  .object({
    section: z.enum(NEWS_SECTIONS),
    title: z.string().trim().max(60),
    body: z.string().trim().max(400),
    image: newsImageSchema.nullable(),
    link: newsLinkSchema.nullable(),
    featured: z.boolean(),
    startsAt: iso.nullable(),
    endsAt: iso.nullable(),
  })
  .strict()
  .refine((p) => !p.startsAt || !p.endsAt || p.startsAt < p.endsAt, { message: 'news_dates', path: ['endsAt'] });
export type NewsPostInput = z.infer<typeof newsPostInputSchema>;

/** A new card: always «custom» (the auto ones come with the game). */
export const adminNewsCreateSchema = newsPostInputSchema.and(z.object({ reason: z.string().trim().min(3).max(200) }));
/** Saving a card: an auto one keeps its kind; its title and text are ignored. */
export const adminNewsSaveSchema = newsPostInputSchema.and(z.object({ reason: z.string().trim().min(3).max(200) }));
/** The new order of a section (every card of it, by id, first to last). */
export const adminNewsOrderSchema = z.object({ section: z.enum(NEWS_SECTIONS), ids: z.array(z.uuid()).max(100) }).strict();
export const newsIdParamSchema = z.object({ id: z.uuid() });

/** POST /admin/media: an image as base64 (PNG, JPG or WebP; checked by its own bytes on the server). */
export const MEDIA_MAX_BYTES = 2 * 1024 * 1024;
export const adminMediaUploadSchema = z
  .object({ name: z.string().trim().min(1).max(80), data: z.base64().max(Math.ceil((MEDIA_MAX_BYTES * 4) / 3) + 8) })
  .strict();

export interface NewsPost {
  id: string;
  kind: NewsKind;
  section: NewsSection;
  title: string;
  body: string;
  image: NewsImage | null;
  link: NewsLink | null;
  featured: boolean;
  order: number;
  startsAt: string | null;
  endsAt: string | null;
  updatedAt: string;
}

/** GET /news: the cards shown now (not hidden, inside their dates), by section and order. */
export interface NewsView {
  posts: NewsPost[];
}

export interface AdminNewsPost extends NewsPost {
  hidden: boolean;
  /** Shown now (not hidden and inside its dates). */
  live: boolean;
  by: string | null;
}

export interface AdminNewsView {
  posts: AdminNewsPost[];
}

export interface MediaAsset {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  createdAt: string;
  /** Cards using it (it can only be deleted at 0). */
  uses: number;
}

export interface AdminMediaView {
  assets: MediaAsset[];
  totalBytes: number;
}

/** Where an uploaded image is served (same origin: the page's image policy allows it). */
export const mediaUrl = (id: string): string => `/galaxy/api/media/${id}`;
