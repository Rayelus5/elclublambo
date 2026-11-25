// El enrutado público fijo como reglas de next.config: Vercel resuelve `redirects` y `rewrites` en su router, sin
// ejecutar el proxy ni ninguna función, y también se aplican a los prefetch del router, que no pasan por el proxy.
// Hacen exactamente lo que deciden decidePublicRoute y legacyClubRedirect (tests/unit/i18n/route-rules.test.ts).
// Solo imports relativos: next.config los carga sin los alias de tsconfig.
import { CLUB_BASE } from "../club/paths";
import { chainsForSet, networkSet } from "../economy/networks";
import { LEGACY_CLUB_SEGMENTS } from "./public-routing";
import { ID_SUFFIXES, PARAM_PATTERNS, PAY_SUFFIXES, localizedPath, type RouteKey } from "./routes";

export type RedirectRule = { source: string; destination: string; permanent: true };
export type RewriteRule = { source: string; destination: string };

/** Las imágenes OG/Twitter del árbol interno se sirven tal cual: nunca se redirigen a su URL pública. */
const IMAGE_SUFFIXES = new Set(["opengraph-image", "twitter-image"]);

const STATIC_KEYS: RouteKey[] = [
  "home",
  "start",
  "tools",
  "giveaways",
  "giveawayNew",
  "payTool",
  "donate",
  "checker",
  "checkerApi",
  "vouches",
  "approvals",
  "multisend",
  "gas",
];

type Params = Parameters<typeof localizedPath>[2];

/** Una ruta del mapa: su URL pública en español y su ruta interna, con los parámetros como patrón o como nombre. */
type Route = { key: RouteKey; pattern?: Params; plain?: Params; suffixes: readonly string[] };

function routes(): Route[] {
  const chains = chainsForSet(networkSet()).join("|");
  return [
    ...STATIC_KEYS.map((key) => ({ key, suffixes: [] })),
    { key: "giveaway", pattern: { id: `:id(${PARAM_PATTERNS.id})` }, plain: { id: ":id" }, suffixes: ID_SUFFIXES },
    {
      key: "pay",
      pattern: { target: `:target(${PARAM_PATTERNS.alias}|${PARAM_PATTERNS.address})` },
      plain: { target: ":target" },
      suffixes: PAY_SUFFIXES,
    },
    {
      key: "payReceipt",
      pattern: { chainId: `:chainId(${chains})`, hash: `:hash(${PARAM_PATTERNS.hash})` },
      plain: { chainId: ":chainId", hash: ":hash" },
      suffixes: [],
    },
  ];
}

const spanish = (key: RouteKey, params: Params) => localizedPath("es", key, params);
/** La ruta interna española (`/es/tools/gas`): la inglesa del mapa con el prefijo `/es`. */
const internal = (key: RouteKey, params: Params) => "/es" + localizedPath("en", key, params).slice("/en".length);
const suffixParam = (suffixes: readonly string[]) => `/:suffix(${suffixes.join("|")})`;

/** Las URLs públicas en español → el árbol interno `/es` (`/` es la landing, `/donar` la página pública). */
export function publicRewrites(): RewriteRule[] {
  return routes().flatMap(({ key, pattern, plain, suffixes }) => {
    const rules: RewriteRule[] = [{ source: spanish(key, pattern), destination: internal(key, plain) }];
    if (suffixes.length > 0) {
      rules.push({ source: spanish(key, pattern) + suffixParam(suffixes), destination: internal(key, plain) + "/:suffix" });
    }
    return rules;
  });
}

/** Una visita directa al árbol interno `/es` → su URL canónica (308), y las URLs antiguas del club → `/foro` (R1-R5). */
export function publicRedirects(): RedirectRule[] {
  const canonical = routes().flatMap(({ key, pattern, plain, suffixes }) => {
    const rules: RedirectRule[] = [{ source: internal(key, pattern), destination: spanish(key, plain), permanent: true }];
    const pageSuffixes = suffixes.filter((s) => !IMAGE_SUFFIXES.has(s));
    if (pageSuffixes.length > 0) {
      rules.push({ source: internal(key, pattern) + suffixParam(pageSuffixes), destination: spanish(key, plain) + "/:suffix", permanent: true });
    }
    return rules;
  });
  const legacy: RedirectRule[] = [
    { source: `/:segment(${[...LEGACY_CLUB_SEGMENTS].join("|")})/:rest*`, destination: `${CLUB_BASE}/:segment/:rest*`, permanent: true },
    // `/donar` exacto es la página pública; `/donar/<algo>` solo existía en el club.
    { source: "/donar/:rest+", destination: `${CLUB_BASE}/donar/:rest+`, permanent: true },
  ];
  return [...legacy, ...canonical];
}
