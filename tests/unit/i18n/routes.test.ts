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
const ADDR = "0xAbCdEf0123456789abcdef0123456789ABCDEF01";
const HASH = "0x" + "ab12".repeat(16);

const rows: {
  route: RouteKey;
  params?: { id?: string; target?: string; chainId?: string; hash?: string };
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
  { route: "payTool", es: "/herramientas/pay", en: "/en/tools/pay", internalEs: "/es/tools/pay", internalEn: "/en/tools/pay" },
  { route: "pay", params: { target: "rayelus" }, es: "/pay/rayelus", en: "/en/pay/rayelus", internalEs: "/es/pay/rayelus", internalEn: "/en/pay/rayelus" },
  { route: "pay", params: { target: ADDR }, es: `/pay/${ADDR}`, en: `/en/pay/${ADDR}`, internalEs: `/es/pay/${ADDR}`, internalEn: `/en/pay/${ADDR}` },
  {
    route: "payReceipt",
    params: { chainId: "84532", hash: HASH },
    es: `/pay/tx/84532/${HASH}`,
    en: `/en/pay/tx/84532/${HASH}`,
    internalEs: `/es/pay/tx/84532/${HASH}`,
    internalEn: `/en/pay/tx/84532/${HASH}`,
  },
  { route: "donate", es: "/donar", en: "/en/donate", internalEs: "/es/donate", internalEn: "/en/donate" },
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
    // Own keys only: an id that is an Object.prototype name is still an id.
    expect(switchLang("/en/tools/giveaways/constructor", "es")).toBe("/herramientas/sorteos/constructor");
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

describe("ElClub Pay and donate routes (P3)", () => {
  it("rejects a short or malformed target", () => {
    expect(toInternalPath("/pay/ab")).toBeNull();
    expect(toInternalPath("/pay/Rayelus")).toBeNull();
    expect(toInternalPath("/pay/a".padEnd(26, "a"))).toBeNull();
    expect(toInternalPath("/pay/0x" + "a".repeat(38))).toBeNull();
    expect(toInternalPath("/pay")).toBeNull();
    expect(toInternalPath("/pay/")).toBeNull();
    expect(toInternalPath("/es/pay/rayelus")).toBeNull();
  });

  it("accepts an address (any case) and the allowed suffixes after a target", () => {
    expect(toInternalPath(`/pay/${ADDR}`)?.internal).toBe(`/es/pay/${ADDR}`);
    expect(toInternalPath(`/pay/${ADDR.toLowerCase()}`)?.internal).toBe(`/es/pay/${ADDR.toLowerCase()}`);
    expect(toInternalPath("/pay/alias/badge")).toEqual({ internal: "/es/pay/alias/badge", lang: "es" });
    expect(toInternalPath("/en/pay/alias/opengraph-image")).toEqual({ internal: "/en/pay/alias/opengraph-image", lang: "en" });
    expect(toInternalPath("/pay/alias/twitter-image")?.internal).toBe("/es/pay/alias/twitter-image");
    expect(toInternalPath("/pay/alias/otro")).toBeNull();
    expect(toInternalPath("/pay/alias/badge/x")).toBeNull();
    expect(toPublicPath("/es/pay/alias/badge")).toBe("/pay/alias/badge");
  });

  it("a target that is a structural word stays a target", () => {
    expect(toInternalPath("/pay/sorteos")?.internal).toBe("/es/pay/sorteos");
    expect(toInternalPath("/pay/herramientas")?.internal).toBe("/es/pay/herramientas");
    expect(switchLang("/pay/sorteos", "en")).toBe("/en/pay/sorteos");
  });

  it("receipt: only chains of the current network set, a 32-byte hash", () => {
    expect(toInternalPath(`/pay/tx/84532/${HASH}`)).not.toBeNull();
    expect(toInternalPath(`/pay/tx/421614/${HASH}`)).not.toBeNull();
    expect(toInternalPath(`/pay/tx/1/${HASH}`)).toBeNull();
    expect(toInternalPath(`/pay/tx/8453/${HASH}`)).toBeNull(); // mainnet id in a testnet build
    expect(toInternalPath("/pay/tx/84532/0x1234")).toBeNull();
    expect(toInternalPath(`/pay/tx/84532/${HASH}/badge`)).toBeNull();
    expect(toInternalPath("/pay/tx")).toBeNull();
  });

  it("donate: /donar and /en/donate only", () => {
    expect(toInternalPath("/donate")).toBeNull();
    expect(toInternalPath("/en/donar")).toBeNull();
    expect(toPublicPath("/es/donate")).toBe("/donar");
    expect(switchLang("/donar", "en")).toBe("/en/donate");
    expect(switchLang("/en/donate", "es")).toBe("/donar");
  });

  it("requires its params", () => {
    expect(() => localizedPath("es", "pay")).toThrow();
    expect(() => localizedPath("es", "payReceipt", { chainId: "84532" })).toThrow();
    expect(alternatesFor("pay", { target: "rayelus" }, "es").languages.en).toBe("/en/pay/rayelus");
    expect(alternatesFor("donate", undefined, "en").languages).toEqual({ es: "/donar", en: "/en/donate", "x-default": "/donar" });
  });
});
