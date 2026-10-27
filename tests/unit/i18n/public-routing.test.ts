import { describe, expect, it } from "vitest";
import { decidePublicRoute } from "@/lib/i18n/public-routing";

const ID = "3f1c0b9e-1111-4c4c-8888-000000000001";

describe("decidePublicRoute", () => {
  it("always serves the landing at / (the club lives under /foro, R1-R3)", () => {
    expect(decidePublicRoute("/")).toEqual({ kind: "rewrite", to: "/es" });
  });

  it("rewrites Spanish public URLs to the internal tree", () => {
    expect(decidePublicRoute("/start")).toEqual({ kind: "rewrite", to: "/es/start" });
    expect(decidePublicRoute("/start")).toEqual({ kind: "rewrite", to: "/es/start" });
    expect(decidePublicRoute("/herramientas")).toEqual({ kind: "rewrite", to: "/es/tools" });
    expect(decidePublicRoute("/herramientas/sorteos/nuevo")).toEqual({ kind: "rewrite", to: "/es/tools/giveaways/new" });
    expect(decidePublicRoute(`/herramientas/sorteos/${ID}`)).toEqual({
      kind: "rewrite",
      to: `/es/tools/giveaways/${ID}`,
    });
  });

  it("passes English public URLs as they are", () => {
    expect(decidePublicRoute("/en")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/en/tools")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/en/start")).toEqual({ kind: "pass" });
  });

  it("redirects direct visits to the internal /es tree to the canonical URL (308)", () => {
    expect(decidePublicRoute("/es/tools")).toEqual({ kind: "redirect", to: "/herramientas" });
    expect(decidePublicRoute("/es")).toEqual({ kind: "redirect", to: "/" });
    expect(decidePublicRoute("/es/start")).toEqual({ kind: "redirect", to: "/start" });
  });

  it("lets the internal OG/Twitter images through at any depth", () => {
    expect(decidePublicRoute("/es/start/opengraph-image")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/es/start/twitter-image")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/es/start/opengraph-image-1a2b3c")).toEqual({ kind: "pass" });
    expect(decidePublicRoute(`/es/tools/giveaways/${ID}/opengraph-image`)).toEqual({ kind: "pass" });
  });

  it("ignores everything else (forum, unknown, invalid ids)", () => {
    expect(decidePublicRoute("/c/abc")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/foro/c/abc")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/sorteos")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/herramientas/sorteos/not-a-uuid")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/xx")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/en/herramientas")).toEqual({ kind: "pass" });
  });
});

describe("decidePublicRoute: /donar and /pay (P3)", () => {
  it("/donar is always the public page (R1-R3)", () => {
    expect(decidePublicRoute("/donar")).toEqual({ kind: "rewrite", to: "/es/donate" });
  });

  it("redirects /es/donate to /donar and passes /en/donate", () => {
    expect(decidePublicRoute("/es/donate")).toEqual({ kind: "redirect", to: "/donar" });
    expect(decidePublicRoute("/en/donate")).toEqual({ kind: "pass" });
  });

  it("rewrites the Spanish pay URLs and ignores invalid ones", () => {
    expect(decidePublicRoute("/herramientas/pay")).toEqual({ kind: "rewrite", to: "/es/tools/pay" });
    expect(decidePublicRoute("/pay/rayelus")).toEqual({ kind: "rewrite", to: "/es/pay/rayelus" });
    expect(decidePublicRoute("/pay/ab")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/en/pay/rayelus")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/es/pay/rayelus")).toEqual({ kind: "redirect", to: "/pay/rayelus" });
  });

  it("lets the internal pay share cards through", () => {
    expect(decidePublicRoute("/es/pay/rayelus/opengraph-image")).toEqual({ kind: "pass" });
  });
});
