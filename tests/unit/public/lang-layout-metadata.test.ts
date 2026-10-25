import { afterEach, describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";

vi.mock("server-only", () => ({}));

// Every public page (the giveaway's share card included) resolves its OG/Twitter image URLs against the site's origin,
// not Next's localhost fallback (PRE runs `next start` behind a tunnel, where that fallback is wrong).
async function load(siteUrl: string | undefined) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", siteUrl);
  const { generateMetadata } = (await import("@/app/(public)/[lang]/layout")) as unknown as { generateMetadata: () => Metadata };
  return generateMetadata();
}

afterEach(() => vi.unstubAllEnvs());

describe("public [lang] layout metadata", () => {
  it("sets metadataBase to the site origin", async () => {
    expect(String((await load("https://pre.elclub.party")).metadataBase)).toBe("https://pre.elclub.party/");
  });

  it("falls back to the canonical origin", async () => {
    expect(String((await load(undefined)).metadataBase)).toBe("https://www.elclub.party/");
  });
});
