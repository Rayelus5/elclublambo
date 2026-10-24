import { describe, expect, it } from "vitest";
import {
  alternatesFor,
  localizedPath,
  switchLang,
  toInternalPath,
  toPublicPath,
  type RouteKey,
} from "../../../src/lib/i18n/routes";
import { LANGS, OG_LOCALE, isLang } from "../../../src/lib/i18n/config";

const ID = "3f1c0b9e-1111-4c4c-8888-000000000001";

const rows: {
  route: RouteKey;
  params?: { id: string };
  es: string;
  en: string;
  internalEs: string;
  internalEn: string;
}[] = [
  { route: "home", es: "/", en: "/en", internalEs: "/es", internalEn: "/en" },
  { route: "start", es: "/start", en: "/en/start", internalEs: "/es/start", internalEn: "/en/start" },
  { route: "tools", es: "/herramientas", en: "/en/tools", internalEs: "/es/tools", internalEn: "/en/tools" },
  {
    route: "giveaways",
    es: "/herramientas/sorteos",
    en: "/en/tools/giveaways",
    internalEs: "/es/tools/giveaways",
    internalEn: "/en/tools/giveaways",
  },
  {
    route: "giveawayNew",
    es: "/herramientas/sorteos/nuevo",
    en: "/en/tools/giveaways/new",
    internalEs: "/es/tools/giveaways/new",
    internalEn: "/en/tools/giveaways/new",
  },
  {
    route: "giveaway",
    params: { id: ID },
    es: `/herramientas/sorteos/${ID}`,
    en: `/en/tools/giveaways/${ID}`,
    internalEs: `/es/tools/giveaways/${ID}`,
    internalEn: `/en/tools/giveaways/${ID}`,
  },
];

describe("config", () => {
  it("langs", () => {
    expect(LANGS).toEqual(["es", "en"]);
    expect(isLang("es")).toBe(true);
    expect(isLang("fr")).toBe(false);
    expect(OG_LOCALE).toEqual({ es: "es_ES", en: "en_US" });
  });
});

describe("route map", () => {
  for (const r of rows) {
    it(`${r.route}: localizedPath`, () => {
      expect(localizedPath("es", r.route, r.params)).toBe(r.es);
      expect(localizedPath("en", r.route, r.params)).toBe(r.en);
    });
    it(`${r.route}: toInternalPath`, () => {
      expect(toInternalPath(r.es)).toEqual({ internal: r.internalEs, lang: "es" });
      expect(toInternalPath(r.en)).toEqual({ internal: r.internalEn, lang: "en" });
    });
    it(`${r.route}: toPublicPath`, () => {
      expect(toPublicPath(r.internalEs)).toBe(r.es);
      expect(toPublicPath(r.internalEn)).toBe(r.en);
    });
  }

  it("translates the OG image suffix and keeps entries", () => {
    expect(toInternalPath(`/herramientas/sorteos/${ID}/opengraph-image`)).toEqual({
      internal: `/es/tools/giveaways/${ID}/opengraph-image`,
      lang: "es",
    });
    expect(toInternalPath(`/en/tools/giveaways/${ID}/twitter-image`)).toEqual({
      internal: `/en/tools/giveaways/${ID}/twitter-image`,
      lang: "en",
    });
    expect(toInternalPath(`/herramientas/sorteos/${ID}/entries`)?.internal).toBe(
      `/es/tools/giveaways/${ID}/entries`,
    );
    expect(toPublicPath(`/es/tools/giveaways/${ID}/entries`)).toBe(
      `/herramientas/sorteos/${ID}/entries`,
    );
  });

  it("accepts uppercase UUIDs", () => {
    const up = ID.toUpperCase();
    expect(toInternalPath(`/herramientas/sorteos/${up}`)?.internal).toBe(
      `/es/tools/giveaways/${up}`,
    );
  });

  it("rejects unknown suffixes and non-UUID ids (R-A)", () => {
    expect(toInternalPath(`/herramientas/sorteos/${ID}/otra`)).toBeNull();
    expect(toInternalPath(`/herramientas/sorteos/${ID}/entries/x`)).toBeNull();
    expect(toInternalPath("/herramientas/sorteos/no-es-uuid")).toBeNull();
    expect(toInternalPath("/herramientas/sorteos/no-es-uuid/opengraph-image")).toBeNull();
    expect(toPublicPath("/es/tools/giveaways/abc")).toBeNull();
    expect(toPublicPath(`/es/tools/giveaways/${ID}/otra`)).toBeNull();
  });

  it("rejects non-public paths", () => {
    expect(toInternalPath("/c/abc")).toBeNull();
    expect(toInternalPath("/es/tools")).toBeNull();
    expect(toInternalPath("/es")).toBeNull();
    expect(toInternalPath("/tools")).toBeNull();
    expect(toInternalPath("/en/herramientas")).toBeNull();
    expect(toInternalPath("/herramientas/nada")).toBeNull();
    expect(toInternalPath("/herramientas/giveaways")).toBeNull();
    expect(toPublicPath("/c/abc")).toBeNull();
    expect(toPublicPath("/fr/tools")).toBeNull();
    expect(toPublicPath("/es/herramientas")).toBeNull();
  });

  it("tolerates a trailing slash", () => {
    expect(toInternalPath("/herramientas/")).toEqual({ internal: "/es/tools", lang: "es" });
    expect(toInternalPath("/en/")).toEqual({ internal: "/en", lang: "en" });
  });

  it("spec examples", () => {
    expect(toInternalPath("/en/tools")).toEqual({ internal: "/en/tools", lang: "en" });
    expect(toPublicPath("/es/tools/giveaways/new")).toBe("/herramientas/sorteos/nuevo");
    expect(toPublicPath("/es")).toBe("/");
    expect(switchLang("/herramientas/sorteos/ID", "en")).toBe("/en/tools/giveaways/ID");
    expect(switchLang("/en/start", "es")).toBe("/start");
  });

  it("switchLang falls back to home for unknown paths and keeps ids", () => {
    expect(switchLang("/", "en")).toBe("/en");
    expect(switchLang("/en", "es")).toBe("/");
    expect(switchLang("/c/abc", "en")).toBe("/en");
    expect(switchLang(`/en/tools/giveaways/${ID}`, "es")).toBe(`/herramientas/sorteos/${ID}`);
  });

  it("alternatesFor", () => {
    expect(alternatesFor("giveaways", undefined, "es")).toEqual({
      canonical: "/herramientas/sorteos",
      languages: {
        es: "/herramientas/sorteos",
        en: "/en/tools/giveaways",
        "x-default": "/herramientas/sorteos",
      },
    });
    expect(alternatesFor("giveaway", { id: ID }, "es").languages.en).toBe(`/en/tools/giveaways/${ID}`);
    expect(alternatesFor("home", undefined, "es").languages).toEqual({ es: "/", en: "/en", "x-default": "/" });
    expect(alternatesFor("giveaways", undefined, "en").canonical).toBe("/en/tools/giveaways");
    expect(alternatesFor("giveaway", { id: ID }, "en").canonical).toBe(`/en/tools/giveaways/${ID}`);
    expect(alternatesFor("giveaways", undefined, "en").languages["x-default"]).toBe("/herramientas/sorteos");
  });

  it("giveaway requires an id", () => {
    expect(() => localizedPath("es", "giveaway")).toThrow();
  });
});
