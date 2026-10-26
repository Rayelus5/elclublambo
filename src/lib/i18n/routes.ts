import { chainsForSet, networkSet } from "../economy/networks";
import { LANGS, isLang, type Lang } from "./config";

export type RouteKey =
  | "home"
  | "start"
  | "tools"
  | "giveaways"
  | "giveawayNew"
  | "giveaway"
  | "payTool"
  | "pay"
  | "payReceipt"
  | "checker"
  | "checkerApi"
  | "donate"
  | "vouches"
  | "approvals"
  | "multisend"
  | "gas";

type Params = { id?: string; target?: string; chainId?: string | number; hash?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Tras `{id}` solo estos segmentos, y pasan tal cual (R-A).
const ID_SUFFIXES = new Set(["opengraph-image", "twitter-image", "entries"]);
// Tras `{target}` de ElClub Pay.
const PAY_SUFFIXES = new Set(["opengraph-image", "twitter-image", "badge"]);
// Herramientas de un solo segmento bajo `tools` (sin sufijos).
const FLAT_TOOLS = new Set(["pay", "vouches", "approvals", "multisend", "gas"]);
const ALIAS = /^[a-z0-9_]{3,20}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

// Segmentos estructurales: interno (inglés) -> URL pública por idioma.
const SEGMENTS: Record<string, Record<Lang, string>> = {
  start: { es: "start", en: "start" },
  tools: { es: "herramientas", en: "tools" },
  giveaways: { es: "sorteos", en: "giveaways" },
  new: { es: "nuevo", en: "new" },
  donate: { es: "donar", en: "donate" },
  checker: { es: "comprobador", en: "checker" },
  api: { es: "api", en: "api" },
  vouches: { es: "avales", en: "vouches" },
  approvals: { es: "aprobaciones", en: "approvals" },
  multisend: { es: "envio-multiple", en: "multisend" },
  gas: { es: "gas", en: "gas" },
};

const ROUTES: Record<RouteKey, string[]> = {
  home: [],
  start: ["start"],
  tools: ["tools"],
  giveaways: ["tools", "giveaways"],
  giveawayNew: ["tools", "giveaways", "new"],
  giveaway: ["tools", "giveaways"], // + id
  payTool: ["tools", "pay"],
  pay: ["pay"], // + target
  payReceipt: ["pay", "tx"], // + chainId + hash
  donate: ["donate"],
  checker: ["tools", "checker"],
  checkerApi: ["tools", "checker", "api"],
  vouches: ["tools", "vouches"],
  approvals: ["tools", "approvals"],
  multisend: ["tools", "multisend"],
  gas: ["tools", "gas"],
};

function split(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

/** `pay/{alias|0x…}[/opengraph-image|twitter-image|badge]` o `pay/tx/{chainId}/{hash}` (cadena del entorno actual). */
function isValidPay(segs: string[]): boolean {
  const target = segs[1];
  if (target === undefined) return false;
  if (target === "tx") {
    if (segs.length !== 4) return false;
    const chains = chainsForSet(networkSet()).map(String);
    return chains.includes(segs[2] ?? "") && TX_HASH.test(segs[3] ?? "");
  }
  if (!ALIAS.test(target) && !ADDRESS.test(target)) return false;
  if (segs.length === 2) return true;
  return segs.length === 3 && PAY_SUFFIXES.has(segs[2] ?? "");
}

/** ¿Es una lista de segmentos internos (ingleses) del mapa cerrado? */
function isValidInternal(segs: string[], strictId = true): boolean {
  const isId = (s: string | undefined) => (s !== undefined && (strictId ? UUID.test(s) : !Object.hasOwn(SEGMENTS, s)));
  if (segs.length === 0) return true;
  if (segs[0] === "pay") return isValidPay(segs);
  if (segs.length === 1) return segs[0] === "start" || segs[0] === "tools" || segs[0] === "donate";
  if (segs[0] === "tools" && FLAT_TOOLS.has(segs[1] ?? "")) return segs.length === 2;
  if (segs[0] === "tools" && segs[1] === "checker") return segs.length === 2 || (segs.length === 3 && segs[2] === "api");
  if (segs[0] !== "tools" || segs[1] !== "giveaways") return false;
  if (segs.length === 2) return true;
  if (segs.length === 3) return segs[2] === "new" || isId(segs[2]);
  if (segs.length === 4) return isId(segs[2]) && ID_SUFFIXES.has(segs[3] ?? "");
  return false;
}

/** Segmentos internos -> segmentos públicos del idioma (sin prefijo de idioma). */
function publicSegments(lang: Lang, segs: string[]): string[] {
  // `pay` es igual en todos los idiomas: lo que sigue (alias, dirección, cadena, hash) son datos, no segmentos.
  if (segs[0] === "pay") return segs;
  return segs.map((s) => SEGMENTS[s]?.[lang] ?? s);
}

function join(lang: Lang, segs: string[]): string {
  const parts = lang === "en" ? ["en", ...segs] : segs;
  return "/" + parts.join("/");
}

export function localizedPath(lang: Lang, route: RouteKey, params?: Params): string {
  const segs = [...ROUTES[route]];
  if (route === "giveaway") {
    if (!params?.id) throw new Error("localizedPath: giveaway requires an id");
    segs.push(params.id);
  }
  if (route === "pay") {
    if (!params?.target) throw new Error("localizedPath: pay requires a target");
    segs.push(params.target);
  }
  if (route === "payReceipt") {
    if (params?.chainId === undefined || !params.hash) throw new Error("localizedPath: payReceipt requires chainId and hash");
    segs.push(String(params.chainId), params.hash);
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
    if (rest[0] === "pay") return s;
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
