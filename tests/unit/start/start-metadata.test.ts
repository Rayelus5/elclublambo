import { afterEach, describe, expect, it, vi } from "vitest";
import type { Metadata, MetadataRoute } from "next";

// metadata and robots read NEXT_PUBLIC_SITE_URL (baked at build time): load them fresh for each host.
async function load(siteUrl: string | undefined, lang: "es" | "en" = "es") {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", siteUrl);
  const { generateMetadata } = (await import("@/app/(public)/[lang]/start/page")) as unknown as {
    generateMetadata: (props: { params: Promise<{ lang: string }> }) => Promise<Metadata>;
  };
  const metadata = await generateMetadata({ params: Promise.resolve({ lang }) });
  const { default: robots } = (await import("@/app/robots")) as { default: () => MetadataRoute.Robots };
  return { metadata, robots: robots() };
}

const rulesOf = (r: MetadataRoute.Robots) => (Array.isArray(r.rules) ? r.rules : [r.rules]);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/start metadata in production", () => {
  it("is indexable, with title, description and the production canonical", async () => {
    const { metadata } = await load("https://www.elclub.party");
    expect(metadata.title).toMatchObject({ absolute: expect.stringContaining("ElClub.") });
    expect(String(metadata.description)).toMatch(/invitación/);
    expect(String(metadata.description)).toMatch(/Base y Arbitrum/);
    expect(String(metadata.description)).toMatch(/donaciones/);
    expect(String(metadata.description)).not.toMatch(/tesorería/i);
    expect(JSON.stringify(metadata)).not.toMatch(/Linea/);
    expect(metadata.alternates?.canonical).toBe("/start");
    expect(metadata.alternates?.languages).toMatchObject({ es: "/start", en: "/en/start", "x-default": "/start" });
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });

  it("has an Open Graph card and a large Twitter card", async () => {
    const { metadata } = await load("https://www.elclub.party");
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      url: "/start",
      siteName: "ElClub.",
      locale: "es_ES",
    });
    expect(metadata.openGraph?.title).toEqual(expect.stringContaining("ElClub."));
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
    expect(metadata.metadataBase).toBeInstanceOf(URL);
  });

  it("the English page is English, en_US, and canonicalizes to /en/start", async () => {
    const { metadata } = await load("https://www.elclub.party", "en");
    expect(metadata.title).toMatchObject({ absolute: expect.stringContaining("private forum") });
    expect(String(metadata.description)).toMatch(/invitation-only/);
    expect(metadata.alternates?.canonical).toBe("/en/start");
    expect(metadata.alternates?.languages).toMatchObject({ es: "/start", en: "/en/start" });
    expect(metadata.openGraph).toMatchObject({ locale: "en_US", url: "/en/start" });
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });

  it("robots.txt allows /start (and the assets it needs) and keeps the private forum out", async () => {
    const { robots } = await load("https://elclub.party");
    const all = rulesOf(robots).find((x) => x.userAgent === "*");
    expect(all).toBeDefined();
    expect([all!.allow].flat()).toEqual(expect.arrayContaining(["/$", "/en$", "/en/", "/start", "/herramientas", "/_next/"]));
    expect(robots.sitemap).toBe("https://elclub.party/sitemap.xml");
    expect([all!.disallow].flat()).toContain("/");
  });

  // Google's rule: the longest matching pattern wins, allow on a tie; `*` any run of characters, `$` the end.
  it.each([
    ["/", true],
    ["/en", true],
    ["/en/tools/giveaways", true],
    ["/start", true],
    ["/herramientas/sorteos", true],
    ["/es/opengraph-image", true],
    ["/es/start/opengraph-image-1a2b3c", true],
    ["/es/tools/giveaways/3f1c0b9e-1111-4c4c-8888-000000000001/twitter-image", true],
    ["/english", false],
    ["/es/tools", false],
    ["/perfil", false],
    ["/c/general", false],
  ])("robots.txt: %s crawlable = %s", async (path, crawlable) => {
    const { robots } = await load("https://elclub.party");
    const all = rulesOf(robots).find((x) => x.userAgent === "*")!;
    const toRe = (p: string) => new RegExp("^" + p.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"));
    const best = (patterns: string[]) => Math.max(-1, ...patterns.filter((p) => toRe(p).test(path)).map((p) => p.length));
    const allow = best([all.allow ?? []].flat());
    const disallow = best([all.disallow ?? []].flat());
    expect(allow >= 0 && allow >= disallow).toBe(crawlable);
  });
});

describe.each(["https://pre.elclub.party", "http://localhost:3000", undefined])("outside production (%s)", (siteUrl) => {
  it("/start is noindex, nofollow", async () => {
    const { metadata } = await load(siteUrl);
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it("robots.txt disallows everything for every user agent", async () => {
    const { robots } = await load(siteUrl);
    const rules = rulesOf(robots);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ userAgent: "*", disallow: "/" });
    expect(rules[0]!.allow).toBeUndefined();
  });
});
