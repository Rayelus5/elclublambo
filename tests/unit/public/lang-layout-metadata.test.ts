import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { generateMetadata } from "@/app/(public)/[lang]/layout";

// Every public page (the giveaway's share card included) resolves its OG/Twitter image URLs against the site's origin,
// not Next's localhost fallback (PRE runs `next start` behind a tunnel, where that fallback is wrong). The origin is read
// at call time, so one static import serves every case.
async function load(siteUrl: string | undefined) {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", siteUrl);
  return generateMetadata();
}

afterEach(() => vi.unstubAllEnvs());

describe("public [lang] layout metadata", { timeout: 15_000 }, () => {
  it("sets metadataBase to the site origin", async () => {
    expect(String((await load("https://pre.elclub.party")).metadataBase)).toBe("https://pre.elclub.party/");
  });

  it("falls back to the canonical origin", async () => {
    expect(String((await load(undefined)).metadataBase)).toBe("https://www.elclub.party/");
  });
});
