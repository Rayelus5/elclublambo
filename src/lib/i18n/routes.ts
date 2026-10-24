import { LANGS, isLang, type Lang } from "./config";

export type RouteKey = "home" | "start" | "tools" | "giveaways" | "giveawayNew" | "giveaway";

type Params = { id?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Tras `{id}` solo estos segmentos, y pasan tal cual (R-A).
const ID_SUFFIXES = new Set(["opengraph-image", "twitter-image", "entries"]);

// Segmentos estructurales: interno (inglés) -> URL pública por idioma.
const SEGMENTS: Record<string, Record<Lang, string>> = {
  start: { es: "start", en: "start" },
  tools: { es: "herramientas", en: "tools" },
  giveaways: { es: "sorteos", en: "giveaways" },
  new: { es: "nuevo", en: "new" },
};

const ROUTES: Record<RouteKey, string[]> = {
  home: [],
  start: ["start"],
  tools: ["tools"],
  giveaways: ["tools", "giveaways"],
  giveawayNew: ["tools", "giveaways", "new"],
  giveaway: ["tools", "giveaways"], // + id
};

function split(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

/** ¿Es una lista de segmentos internos (ingleses) del mapa cerrado? */
function isValidInternal(segs: string[], strictId = true): boolean {
  const isId = (s: string | undefined) => (s !== undefined && (strictId ? UUID.test(s) : !(s in SEGMENTS)));
  if (segs.length === 0) return true;
  if (segs.length === 1) return segs[0] === "start" || segs[0] === "tools";
  if (segs[0] !== "tools" || segs[1] !== "giveaways") return false;
  if (segs.length === 2) return true;
  if (segs.length === 3) return segs[2] === "new" || isId(segs[2]);
  if (segs.length === 4) return isId(segs[2]) && ID_SUFFIXES.has(segs[3] ?? "");
  return false;
}

/** Segmentos internos -> segmentos públicos del idioma (sin prefijo de idioma). */
function publicSegments(lang: Lang, segs: string[]): string[] {
  return segs.map((s) => SEGMENTS[s]?.[lang] ?? s);
}

function join(lang: Lang, segs: string[]): string {
  const parts = lang === "en" ? ["en", ...segs] : segs;
  return "/" + parts.join("/");
}

export function localizedPath(lang: Lang, route: RouteKey, params?: Params): string {
  const segs = [...ROUTES[route]];
  if (route === "giveawayNew") segs[2] = "new";
  if (route === "giveaway") {
    if (!params?.id) throw new Error("localizedPath: giveaway requires an id");
    segs.push(params.id);
  }
  return join(lang, publicSegments(lang, segs));
}

export function toInternalPath(
  pathname: string,
  strictId = true,
): { internal: string; lang: Lang } | null {
  const raw = split(pathname);
  let lang: Lang = "es";
  let rest = raw;
  if (raw[0] === "en") {
    lang = "en";
    rest = raw.slice(1);
  }
  // Vuelta por el idioma: cada segmento estructural debe ser el de ese idioma
  // (así `/tools` o `/en/herramientas` no se aceptan como URL públicas).
  const internalSegs = rest.map((s) => {
    for (const [internal, names] of Object.entries(SEGMENTS)) {
      if (names[lang] === s) return internal;
    }
    return s;
  });
  if (!isValidInternal(internalSegs, strictId)) return null;
  if (join(lang, publicSegments(lang, internalSegs)) !== join(lang, rest)) return null;
  return { internal: "/" + [lang, ...internalSegs].join("/"), lang };
}

export function toPublicPath(internalPathname: string): string | null {
  const [lang, ...segs] = split(internalPathname);
  if (!lang || !isLang(lang) || !isValidInternal(segs)) return null;
  return join(lang, publicSegments(lang, segs));
}

export function switchLang(pathname: string, to: Lang): string {
  // Pensado para el selector de idioma: el id no se valida (la página ya existe).
  const parsed = toInternalPath(pathname, false);
  if (!parsed) return localizedPath(to, "home");
  const segs = split(parsed.internal).slice(1);
  return join(to, publicSegments(to, segs));
}

export function alternatesFor(
  route: RouteKey,
  params: Params | undefined,
  lang: Lang,
): { canonical: string; languages: { es: string; en: string; "x-default": string } } {
  const es = localizedPath("es", route, params);
  const en = localizedPath("en", route, params);
  return { canonical: localizedPath(lang, route, params), languages: { es, en, "x-default": es } };
}

export { LANGS };
