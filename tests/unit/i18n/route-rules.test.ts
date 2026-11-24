// @vitest-environment node
import { getRedirectUrl, getRewrittenUrl, unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { chainsForSet, networkSet } from "@/lib/economy/networks";
import { LEGACY_CLUB_SEGMENTS, decidePublicRoute, legacyClubRedirect } from "@/lib/i18n/public-routing";
import { LANGS, localizedPath, type RouteKey } from "@/lib/i18n/routes";

// The public routing (Spanish URLs → internal /es tree, /es/* → canonical URL, old club URLs → /foro) lives in
// next.config: Vercel resolves redirects and rewrites in its router, without running the proxy or any function, and they
// also apply to the router's prefetches, which skip the proxy. decidePublicRoute and legacyClubRedirect stay the
// specification: next.config must decide exactly what they decide, for every URL of the route map.

const ORIGIN = "https://www.elclub.party";
const ID = "3f1c0b9e-1111-4c4c-8888-000000000001";
const ADDRESS = "0x" + "ab".repeat(20);
const HASH = "0x" + "cd".repeat(32);
const CHAIN = String(chainsForSet(networkSet())[0]);

const KEYS: RouteKey[] = [
  "home",
  "start",
  "tools",
  "giveaways",
  "giveawayNew",
  "giveaway",
  "payTool",
  "pay",
  "payReceipt",
  "checker",
  "checkerApi",
  "donate",
  "vouches",
  "approvals",
  "multisend",
  "gas",
];

function paramsFor(key: RouteKey, variant: 0 | 1) {
  if (key === "giveaway") return { id: ID };
  if (key === "pay") return { target: variant === 0 ? "rayelus" : ADDRESS };
  if (key === "payReceipt") return { chainId: CHAIN, hash: HASH };
  return undefined;
}

/** Every public URL of the map (both languages) and its internal tree path, plus the suffixed routes. */
function mapUrls(): string[] {
  const urls = new Set<string>();
  for (const lang of LANGS) {
    for (const key of KEYS) {
      for (const variant of [0, 1] as const) {
        const pub = localizedPath(lang, key, paramsFor(key, variant));
        const internal = "/" + lang + localizedPath("en", key, paramsFor(key, variant)).slice("/en".length);
        urls.add(pub);
        urls.add(internal);
        if (key === "giveaway") {
          for (const suffix of ["entries", "opengraph-image", "twitter-image", "opengraph-image-1km1ej"]) {
            urls.add(`${pub}/${suffix}`);
            urls.add(`${internal}/${suffix}`);
          }
        }
        if (key === "pay") {
          for (const suffix of ["badge", "opengraph-image", "twitter-image", "twitter-image-x2so5w"]) {
            urls.add(`${pub}/${suffix}`);
            urls.add(`${internal}/${suffix}`);
          }
        }
      }
    }
  }
  return [...urls];
}

const OUTSIDE_THE_MAP = [
  "/herramientas/sorteos/not-a-uuid",
  `/herramientas/sorteos/${ID}/x`,
  `/herramientas/sorteos/${ID}/entries/x`,
  "/herramientas/nope",
  "/herramientas/gas/x",
  "/pay",
  "/pay/ab",
  "/pay/rayelus/x",
  "/pay/rayelus/badge/x",
  `/pay/tx/1/${HASH}`,
  `/pay/tx/${CHAIN}/0x12`,
  `/pay/tx/${CHAIN}`,
  "/en/herramientas",
  "/tools",
  "/es/herramientas",
  "/es/tools/nope",
  "/es/opengraph-image",
  "/es/opengraph-image-g96pxp",
  "/en/opengraph-image-g96pxp",
  "/es/start/twitter-image-emtjnu",
  "/xx",
  "/startx",
  "/donarx",
  "/foro",
  "/foro/c/abc",
  "/foro/donar",
  "/api/v1/check/token",
  "/api/cron/dao",
  "/robots.txt",
  "/sitemap.xml",
  "/status/es/maintenance",
  "/out",
];

const LEGACY = [...LEGACY_CLUB_SEGMENTS].flatMap((seg) => [`/${seg}`, `/${seg}/x`, `/${seg}/x/y`]).concat(["/donar/x", "/donar/x/y"]);

type Decision = { kind: "redirect"; to: string; status: number } | { kind: "rewrite"; to: string } | { kind: "pass" };

/** What the old proxy did with this URL (legacy club redirect first, then the public routing). */
function expected(path: string, search: string): Decision {
  const legacy = legacyClubRedirect(path, search);
  if (legacy !== null) return { kind: "redirect", to: legacy, status: 308 };
  const route = decidePublicRoute(path);
  if (route.kind === "redirect") return { kind: "redirect", to: route.to + search, status: 308 };
  if (route.kind === "rewrite") return { kind: "rewrite", to: route.to + search };
  return { kind: "pass" };
}

const pathAndQuery = (url: string) => {
  const u = new URL(url, ORIGIN);
  return u.pathname + u.search;
};

async function decidedByConfig(path: string, search: string): Promise<Decision> {
  const res = await unstable_getResponseFromNextConfig({ url: ORIGIN + path + search, nextConfig });
  const location = getRedirectUrl(res);
  if (location) return { kind: "redirect", to: pathAndQuery(location), status: res.status };
  const rewrite = getRewrittenUrl(res);
  if (rewrite) return { kind: "rewrite", to: pathAndQuery(rewrite) };
  return { kind: "pass" };
}

describe("public routing in next.config", () => {
  const urls = [...mapUrls(), ...OUTSIDE_THE_MAP, ...LEGACY];

  it("covers the whole route map (sanity check of the corpus)", () => {
    expect(urls).toContain("/herramientas/sorteos/nuevo");
    expect(urls).toContain(`/es/tools/giveaways/${ID}/entries`);
    expect(urls).toContain(`/pay/tx/${CHAIN}/${HASH}`);
    expect(urls.length).toBeGreaterThan(150);
  });

  it.each(["", "?a=1&b=2"])("decides every URL exactly like the proxy did (query %j)", async (search) => {
    for (const path of urls) {
      expect(await decidedByConfig(path, search), path + search).toEqual(expected(path, search));
    }
  });

  it("rewrites the landing and the Spanish public URLs to the internal tree", async () => {
    expect(await decidedByConfig("/", "")).toEqual({ kind: "rewrite", to: "/es" });
    expect(await decidedByConfig("/herramientas/envio-multiple", "")).toEqual({ kind: "rewrite", to: "/es/tools/multisend" });
    expect(await decidedByConfig("/donar", "")).toEqual({ kind: "rewrite", to: "/es/donate" });
  });

  it("308s the internal /es tree and the old club URLs, keeping the query", async () => {
    expect(await decidedByConfig("/es/tools/gas", "?x=1")).toEqual({ kind: "redirect", to: "/herramientas/gas?x=1", status: 308 });
    expect(await decidedByConfig("/invite/Zx_9-a", "?ref=2")).toEqual({ kind: "redirect", to: "/foro/invite/Zx_9-a?ref=2", status: 308 });
  });

  it("redirects to a path, never to an absolute URL (behind the tunnel the bind address must not leak)", async () => {
    const routes = await nextConfig.redirects!();
    for (const r of routes) expect(r.destination.startsWith("/"), r.source).toBe(true);
  });
});
