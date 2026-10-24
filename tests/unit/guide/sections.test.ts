import { describe, expect, it } from "vitest";
import { GUIDE_SECTIONS, isGuideSlug } from "@/lib/guide/sections";

describe("GUIDE_SECTIONS", () => {
  it("has the 7 slugs in order", () => {
    expect(GUIDE_SECTIONS.map((s) => s.slug)).toEqual(["propinas", "bounties", "donaciones", "sorteos", "encuestas", "candados", "redes"]);
  });
  it("gives each a title and a summary", () => {
    for (const s of GUIDE_SECTIONS) {
      expect(s.title.trim()).not.toBe("");
      expect(s.summary.trim()).not.toBe("");
    }
  });
  it("lists the donations section as «Donaciones y Mecenas»", () => {
    expect(GUIDE_SECTIONS.find((s) => s.slug === "donaciones")?.title).toBe("Donaciones y Mecenas");
  });
  it("recognises only known slugs", () => {
    expect(isGuideSlug("sorteos")).toBe(true);
    expect(isGuideSlug("dao")).toBe(false);
    expect(isGuideSlug("fondo")).toBe(false);
    expect(isGuideSlug("nope")).toBe(false);
  });
});
