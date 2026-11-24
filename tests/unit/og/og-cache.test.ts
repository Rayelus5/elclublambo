// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// Share cards cost a full image render each (the heaviest request of the site) and are fetched by every link preview and
// crawler. The ones that only depend on the language are built once at build time; the per-link ones carry an s-maxage so
// the CDN answers the repeats without running a function.

vi.mock("server-only", () => ({}));
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(
      readonly element: unknown,
      readonly options: { headers?: Record<string, string> },
    ) {}
  },
}));
vi.mock("@/lib/public-giveaways/queries", () => ({ getPublicGiveaway: async () => null }));

type ImageModule = {
  default: (props: { params: Promise<Record<string, string>> }) => Promise<{ options: { headers?: Record<string, string> } }>;
  generateStaticParams?: () => unknown;
};

const sMaxAge = (cacheControl: string | undefined) => Number(/s-maxage=(\d+)/.exec(cacheControl ?? "")?.[1] ?? 0);

describe("share cards of the landing and /start", () => {
  it.each([
    ["landing opengraph", () => import("@/app/(public)/[lang]/opengraph-image")],
    ["landing twitter", () => import("@/app/(public)/[lang]/twitter-image")],
    ["start opengraph", () => import("@/app/(public)/[lang]/start/opengraph-image")],
    ["start twitter", () => import("@/app/(public)/[lang]/start/twitter-image")],
  ])("%s: built at build time for both languages", async (_name, load) => {
    const mod = (await load()) as unknown as ImageModule;
    expect(await mod.generateStaticParams?.()).toEqual([{ lang: "es" }, { lang: "en" }]);
  });
});

describe("per-link share cards", () => {
  it.each([
    ["pay opengraph", () => import("@/app/(public)/[lang]/pay/[target]/opengraph-image"), { lang: "es", target: "rayelus" }],
    ["pay twitter", () => import("@/app/(public)/[lang]/pay/[target]/twitter-image"), { lang: "en", target: "rayelus" }],
    ["giveaway opengraph", () => import("@/app/(public)/[lang]/tools/giveaways/[id]/opengraph-image"), { lang: "es", id: "x" }],
    ["giveaway twitter", () => import("@/app/(public)/[lang]/tools/giveaways/[id]/twitter-image"), { lang: "en", id: "x" }],
  ] as const)("%s: cached by the CDN for at least an hour", async (_name, load, params) => {
    const mod = (await load()) as unknown as ImageModule;
    const res = await mod.default({ params: Promise.resolve({ ...params }) });
    const cacheControl = res.options.headers?.["Cache-Control"];
    expect(cacheControl).toContain("public");
    expect(sMaxAge(cacheControl)).toBeGreaterThanOrEqual(3600);
  });
});
