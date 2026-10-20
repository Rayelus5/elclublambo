import { describe, expect, it } from "vitest";
import { metadata } from "@/app/start/page";
import robots from "@/app/robots";

describe("/start metadata", () => {
  it("is indexable, with title, description and the production canonical", () => {
    expect(metadata.title).toMatchObject({ absolute: expect.stringContaining("ElClub.") });
    expect(String(metadata.description)).toMatch(/invitación/);
    expect(metadata.alternates?.canonical).toBe("https://www.elclub.party/start");
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });

  it("has an Open Graph card and a large Twitter card", () => {
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      url: "https://www.elclub.party/start",
      siteName: "ElClub.",
      locale: "es_ES",
    });
    expect(metadata.openGraph?.title).toEqual(expect.stringContaining("ElClub."));
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
    expect(metadata.metadataBase).toBeInstanceOf(URL);
  });
});

describe("robots.txt", () => {
  it("allows /start (and the assets it needs) and keeps the private forum out", () => {
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    const all = rules.find((x) => x.userAgent === "*");
    expect(all).toBeDefined();
    expect([all!.allow].flat()).toEqual(expect.arrayContaining(["/start", "/_next/"]));
    expect([all!.disallow].flat()).toContain("/");
  });
});
