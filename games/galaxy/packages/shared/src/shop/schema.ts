import { z } from 'zod';
import { ART_AVATARS, ART_FRAMES, ART_SKINS } from '../cosmetics/catalog';

// The resource shop (shop and lab plan, F4): coins, star dust and components for real money, paid with Stripe. Its
// catalogue is live config (`shop`), so the admin edits everything: what each product gives, its price shown and the
// Stripe price that charges it, offers, badges and limits. It is born closed (`enabled: false`), and when opened it is
// first for the staff alone (`audience: 'staff'`). No product ever gives scanner signals (owner's decision): the shop
// only sells the currencies the Laboratorio and the station spend, and the coins the scanner already takes.

/** What the shop sells. */
export const SHOP_CURRENCIES = ['coins', 'dust', 'components'] as const;
export type ShopCurrency = (typeof SHOP_CURRENCIES)[number];
export type ShopAmounts = Record<ShopCurrency, number>;

const SLUG = /^[a-z0-9-]{1,32}$/;
/** A Stripe price id (`price_…`): the one Stripe charges, which must match the price shown. */
const stripePrice = z.string().regex(/^price_[A-Za-z0-9]{1,64}$/, 'Un precio de Stripe empieza por price_');
const amount = z.number().int().min(0).max(1_000_000);
const amountsSchema = z.object({ coins: amount.default(0), dust: amount.default(0), components: amount.default(0) }).strict();
/** Euro cents: from Stripe's minimum (0,50 €) to 200 €. */
const cents = z.number().int().min(50).max(20_000);
const MAX_OFFER_MS = 31 * 86_400_000;

const offerSchema = z
  .discriminatedUnion('kind', [
    /** «+X % de regalo» while it lasts: the price stays, the product gives more (no «antes» price to show). */
    z.object({ kind: z.literal('bonus'), percent: z.number().int().min(1).max(200), startsAt: z.iso.datetime(), endsAt: z.iso.datetime() }).strict(),
    /** A lower price while it lasts, charged with its own Stripe price; the «antes» is the server's (EU Omnibus rule). */
    z.object({ kind: z.literal('price'), priceCents: cents, stripePriceId: stripePrice.nullable().default(null), startsAt: z.iso.datetime(), endsAt: z.iso.datetime() }).strict(),
  ])
  .refine((o) => Date.parse(o.endsAt) > Date.parse(o.startsAt), 'La oferta termina antes de empezar')
  .refine((o) => Date.parse(o.endsAt) - Date.parse(o.startsAt) <= MAX_OFFER_MS, 'Una oferta dura 31 días como mucho');

export const shopProductSchema = z
  .object({
    id: z.string().regex(SLUG),
    /**
     * `pack`: one currency (its tab); `bundle`: several; `welcome`: the welcome pack, once per account; `cosmetic` (Nov
     * plan C5): a profile piece (avatar, frame or title) in the «Estilo» tab, once per account, no currency.
     */
    kind: z.enum(['pack', 'bundle', 'welcome', 'cosmetic']),
    name: z.string().trim().min(1).max(40),
    /** The illustration it shows (an id of the shop's art). */
    art: z.string().regex(/^[a-z0-9-]{0,32}$/).default(''),
    grants: amountsSchema.prefault({}),
    /** The «+N de regalo» it always gives on top (bigger packs, better value). */
    bonus: amountsSchema.prefault({}),
    priceCents: cents,
    stripePriceId: stripePrice.nullable().default(null),
    offer: offerSchema.nullable().default(null),
    badge: z.enum(['popular', 'best', 'new', 'limited']).nullable().default(null),
    /** Shown big at the top of the shop. */
    featured: z.boolean().default(false),
    enabled: z.boolean().default(true),
    /** Only the staff sees it (the 0,50 € test purchase). */
    staffOnly: z.boolean().default(false),
    /** Its first purchase gets `firstPurchase.percent` more, when that is on. */
    firstBonus: z.boolean().default(false),
    /** A cosmetic's piece (Nov plan C5): an avatar or frame with art, or a title. */
    cosmetic: z.object({ kind: z.enum(['avatar', 'frame', 'title', 'skin']), id: z.string().trim().min(1).max(32) }).strict().nullable().default(null),
    /** How many times one account can buy it (null: no limit; the welcome pack is always once). */
    maxPerAccount: z.number().int().min(1).max(100).nullable().default(null),
  })
  .strict();
export type ShopProduct = z.output<typeof shopProductSchema>;

const pack = (currency: ShopCurrency, n: number, name: string, base: number, bonus: number, priceCents: number, badge: ShopProduct['badge'] = null): ShopProduct => ({
  id: `${currency}-${n}`,
  kind: 'pack',
  name,
  art: `${currency}-${n}`,
  grants: { coins: 0, dust: 0, components: 0, [currency]: base },
  bonus: { coins: 0, dust: 0, components: 0, [currency]: bonus },
  priceCents,
  stripePriceId: null,
  offer: null,
  badge,
  featured: false,
  enabled: true,
  staffOnly: false,
  firstBonus: true,
  cosmetic: null,
  maxPerAccount: null,
});
const bundle = (id: string, name: string, grants: ShopAmounts, priceCents: number, extra: Partial<ShopProduct> = {}): ShopProduct => ({
  id,
  kind: 'bundle',
  name,
  art: id,
  grants,
  bonus: { coins: 0, dust: 0, components: 0 },
  priceCents,
  stripePriceId: null,
  offer: null,
  badge: null,
  featured: false,
  enabled: true,
  staffOnly: false,
  firstBonus: false,
  cosmetic: null,
  maxPerAccount: null,
  ...extra,
});

function cosmetic(id: string, name: string, piece: NonNullable<ShopProduct['cosmetic']>, priceCents: number, badge: ShopProduct['badge'] = null): ShopProduct {
  return {
    id,
    kind: 'cosmetic',
    name,
    art: '',
    grants: { coins: 0, dust: 0, components: 0 },
    bonus: { coins: 0, dust: 0, components: 0 },
    priceCents,
    stripePriceId: null,
    offer: null,
    badge,
    featured: false,
    enabled: false,
    staffOnly: false,
    firstBonus: false,
    cosmetic: piece,
    maxPerAccount: 1,
  };
}

/** The default catalogue (the approved ladder of the F0 mockups): six packs of each currency, three bundles and the welcome pack. */
export const DEFAULT_SHOP_PRODUCTS: ShopProduct[] = [
  bundle('welcome', 'Pack de bienvenida', { coins: 1500, dust: 800, components: 200 }, 199, { kind: 'welcome', maxPerAccount: 1, badge: 'new' }),
  pack('coins', 1, 'Puñado de monedas', 500, 0, 399),
  pack('coins', 2, 'Bolsa de monedas', 1000, 200, 699),
  pack('coins', 3, 'Saco de monedas', 2000, 500, 1299, 'popular'),
  pack('coins', 4, 'Cofre de monedas', 4000, 1300, 2499),
  pack('coins', 5, 'Arca de monedas', 8000, 3000, 4999),
  pack('coins', 6, 'Bóveda estelar', 15000, 8000, 9999, 'best'),
  pack('dust', 1, 'Pizca de polvo', 250, 0, 399),
  pack('dust', 2, 'Frasco de polvo', 500, 100, 699),
  pack('dust', 3, 'Tarro de polvo', 1000, 250, 1299, 'popular'),
  pack('dust', 4, 'Ánfora de polvo', 2000, 650, 2499),
  pack('dust', 5, 'Nebulosa embotellada', 4000, 1500, 4999),
  pack('dust', 6, 'Galaxia de polvo', 7500, 4000, 9999, 'best'),
  pack('components', 1, 'Caja de piezas', 100, 0, 399),
  pack('components', 2, 'Kit de componentes', 200, 40, 699),
  pack('components', 3, 'Cajón técnico', 400, 100, 1299, 'popular'),
  pack('components', 4, 'Palé de componentes', 800, 260, 2499),
  pack('components', 5, 'Contenedor de carga', 1600, 600, 4999),
  pack('components', 6, 'Fábrica en una caja', 3000, 1600, 9999, 'best'),
  bundle('kit-arranque', 'Kit de arranque', { coins: 1200, dust: 600, components: 150 }, 999),
  bundle('kit-explorador', 'Kit del explorador', { coins: 4500, dust: 2250, components: 600 }, 1999, { badge: 'popular', featured: true }),
  bundle('kit-comandante', 'Kit del comandante', { coins: 12000, dust: 6000, components: 1600 }, 4999, { badge: 'best' }),
  // Nov plan C5: the shop's exclusive cosmetics, off until their Stripe prices are set.
  cosmetic('style-nebula-queen', 'Reina de la nebulosa', { kind: 'avatar', id: 'shop-nebula-queen' }, 299, 'new'),
  cosmetic('style-void-knight', 'Caballero del vacío', { kind: 'avatar', id: 'shop-void-knight' }, 299),
  cosmetic('style-star-fox', 'Zorro estelar', { kind: 'avatar', id: 'shop-star-fox' }, 199),
  cosmetic('style-comet-rider', 'Jinete del cometa', { kind: 'avatar', id: 'shop-comet-rider' }, 199),
  cosmetic('style-prism', 'Marco Prisma', { kind: 'frame', id: 'prism' }, 299, 'popular'),
  cosmetic('style-solar', 'Marco Corona solar', { kind: 'frame', id: 'solar' }, 249),
  cosmetic('style-eclipse', 'Marco Eclipse', { kind: 'frame', id: 'eclipse' }, 149),
  cosmetic('style-starlight', 'Marco Luz de estrellas', { kind: 'frame', id: 'starlight' }, 99),
  cosmetic('style-patron', 'Título «Mecenas estelar»', { kind: 'title', id: 'Mecenas estelar' }, 199),
  cosmetic('style-pioneer', 'Título «Pionero del ECN»', { kind: 'title', id: 'Pionero del ECN' }, 149),
  cosmetic('style-guardian', 'Título «Guardián de la nebulosa»', { kind: 'title', id: 'Guardián de la nebulosa' }, 99),
  cosmetic('style-voyager', 'Título «Viajero del vacío»', { kind: 'title', id: 'Viajero del vacío' }, 99),
  // Plan «skins», part C2: the Leyenda skins (animated), from 1,99 to 3,99 €, off until their Stripe prices are set.
  cosmetic('style-skin-lumen', 'Lumen leyenda', { kind: 'skin', id: 'skin-lumen-leyenda' }, 399, 'new'),
  cosmetic('style-skin-bastion', 'Bastión leyenda', { kind: 'skin', id: 'skin-bastion-leyenda' }, 299),
  cosmetic('style-skin-spark', 'Chispa leyenda', { kind: 'skin', id: 'skin-spark-leyenda' }, 299),
  cosmetic('style-skin-sentinel', 'Vigía leyenda', { kind: 'skin', id: 'skin-sentinel-leyenda' }, 199),
  cosmetic('style-skin-anchor', 'Áncora leyenda', { kind: 'skin', id: 'skin-anchor-leyenda' }, 199),
  cosmetic('style-skin-prism', 'Prisma leyenda', { kind: 'skin', id: 'skin-prism-leyenda' }, 399, 'popular'),
  cosmetic('style-skin-comet', 'Cometa leyenda', { kind: 'skin', id: 'skin-comet-leyenda' }, 299),
  cosmetic('style-skin-echo', 'Eco leyenda', { kind: 'skin', id: 'skin-echo-leyenda' }, 299),
];

const total = (p: Pick<ShopProduct, 'grants' | 'bonus'>, c: ShopCurrency) => p.grants[c] + p.bonus[c];

/** The checks across the catalogue: ids and Stripe prices once, packs of one currency, and an open shop charges in Stripe. */
function shopIssues(shop: { enabled: boolean; limits: { dailyCents: number }; products: ShopProduct[] }, ctx: z.RefinementCtx): void {
  const ids = new Set<string>();
  const prices = new Map<string, string>();
  shop.products.forEach((p, i) => {
    const at = ['products', i];
    if (ids.has(p.id)) ctx.addIssue({ code: 'custom', path: [...at, 'id'], message: `Hay dos productos con el id ${p.id}` });
    ids.add(p.id);
    const given = SHOP_CURRENCIES.filter((c) => total(p, c) > 0);
    // A cosmetic gives its piece and nothing else; only a cosmetic has a piece, and the piece must have art.
    const piece = p.cosmetic;
    const art: Record<'avatar' | 'frame' | 'skin', readonly string[]> = { avatar: ART_AVATARS, frame: ART_FRAMES, skin: ART_SKINS };
    const known = !piece || piece.kind === 'title' || art[piece.kind].includes(piece.id);
    if ((p.kind === 'cosmetic') !== (piece != null) || !known) ctx.addIssue({ code: 'custom', path: [...at, 'cosmetic'], message: 'shop_cosmetic_piece' });
    if (p.kind === 'cosmetic' && given.length > 0) ctx.addIssue({ code: 'custom', path: [...at, 'grants'], message: 'shop_cosmetic_grants' });
    if (p.kind !== 'cosmetic' && given.length === 0) ctx.addIssue({ code: 'custom', path: [...at, 'grants'], message: 'No da nada' });
    if (p.kind === 'pack' && given.length > 1) ctx.addIssue({ code: 'custom', path: [...at, 'grants'], message: 'Un pack da un solo recurso (para varios, un pack combinado)' });
    if (p.kind === 'welcome' && p.maxPerAccount !== 1) ctx.addIssue({ code: 'custom', path: [...at, 'maxPerAccount'], message: 'El pack de bienvenida se compra una vez' });
    if (p.offer?.kind === 'price' && p.offer.priceCents >= p.priceCents) ctx.addIssue({ code: 'custom', path: [...at, 'offer', 'priceCents'], message: 'El precio de oferta debe ser menor que el normal' });
    for (const [where, id] of [
      ['stripePriceId', p.stripePriceId],
      ['offer.stripePriceId', p.offer?.kind === 'price' ? p.offer.stripePriceId : null],
    ] as const) {
      if (id === null) continue;
      const other = prices.get(id);
      if (other) ctx.addIssue({ code: 'custom', path: [...at, ...where.split('.')], message: `El precio de Stripe ${id} ya lo usa ${other}` });
      prices.set(id, p.id);
    }
    if (shop.enabled && p.enabled) {
      if (p.stripePriceId === null) ctx.addIssue({ code: 'custom', path: [...at, 'stripePriceId'], message: `Con la tienda abierta, ${p.id} necesita su precio de Stripe` });
      if (p.offer?.kind === 'price' && p.offer.stripePriceId === null) ctx.addIssue({ code: 'custom', path: [...at, 'offer', 'stripePriceId'], message: `Con la tienda abierta, la oferta de ${p.id} necesita su precio de Stripe` });
    }
    if (p.enabled && p.priceCents > shop.limits.dailyCents) ctx.addIssue({ code: 'custom', path: [...at, 'priceCents'], message: `${p.id} cuesta más que el límite diario` });
  });
}

export const shopSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Who sees it while open: only the staff (signed in with TOTP), or everyone. */
    audience: z.enum(['staff', 'everyone']).default('staff'),
    limits: z
      .object({
        /** What one account can spend in a Madrid day, in cents (paid and in progress). */
        dailyCents: z.number().int().min(50).max(100_000).default(10_000),
        /** Payments one account can have open at once. */
        pendingMax: z.number().int().min(1).max(10).default(3),
      })
      .strict()
      .prefault({}),
    /** The first purchase of each product marked `firstBonus` gives this much more. */
    firstPurchase: z.object({ enabled: z.boolean().default(true), percent: z.number().int().min(1).max(200).default(100) }).strict().prefault({}),
    /** The seller shown in the purchase terms (the owner's data lives here, never in the public repo). */
    legal: z
      .object({
        seller: z.string().trim().max(120).default(''),
        contact: z.string().trim().max(120).default(''),
        /** The terms' version a purchase accepts: change it when the terms change. */
        termsVersion: z.string().regex(SLUG).default('v1'),
      })
      .strict()
      .prefault({}),
    products: z.array(shopProductSchema).max(40).default(DEFAULT_SHOP_PRODUCTS),
  })
  .strict()
  .superRefine((shop, ctx) => shopIssues(shop, ctx));
export type ShopConfig = z.output<typeof shopSchema>;
