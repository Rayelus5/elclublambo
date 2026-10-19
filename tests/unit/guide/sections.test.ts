import { describe, expect, it } from "vitest";
import { GUIDE_SECTIONS, isGuideSlug } from "@/lib/guide/sections";

describe("GUIDE_SECTIONS", () => {
  it("has the 7 slugs in order", () => {
    expect(GUIDE_SECTIONS.map((s) => s.slug)).toEqual(["propinas", "bounties", "dao", "fondo", "encuestas", "candados", "redes"]);
  });
  it("gives each a title and a summary", () => {
    for (const s of GUIDE_SECTIONS) {
      expect(s.title.trim()).not.toBe("");
      expect(s.summary.trim()).not.toBe("");
    }
  });
  it("lists the fund section as «El fondo común»", () => {
    expect(GUIDE_SECTIONS.find((s) => s.slug === "fondo")?.title).toBe("El fondo común");
  });
  it("recognises only known slugs", () => {
    expect(isGuideSlug("dao")).toBe(true);
    expect(isGuideSlug("nope")).toBe(false);
  });
});
