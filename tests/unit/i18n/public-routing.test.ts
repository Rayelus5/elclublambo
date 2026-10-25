import { describe, expect, it } from "vitest";
import { decidePublicRoute } from "@/lib/i18n/public-routing";

const ID = "3f1c0b9e-1111-4c4c-8888-000000000001";

describe("decidePublicRoute", () => {
  it("serves the landing at / unless the visitor is a member", () => {
    expect(decidePublicRoute("/", "anon")).toEqual({ kind: "rewrite", to: "/es" });
    expect(decidePublicRoute("/", "public")).toEqual({ kind: "rewrite", to: "/es" });
    expect(decidePublicRoute("/", "member")).toEqual({ kind: "pass" });
  });

  it("rewrites Spanish public URLs to the internal tree", () => {
    expect(decidePublicRoute("/start", "member")).toEqual({ kind: "rewrite", to: "/es/start" });
    expect(decidePublicRoute("/start", "anon")).toEqual({ kind: "rewrite", to: "/es/start" });
    expect(decidePublicRoute("/herramientas", "anon")).toEqual({ kind: "rewrite", to: "/es/tools" });
    expect(decidePublicRoute("/herramientas/sorteos/nuevo", "anon")).toEqual({ kind: "rewrite", to: "/es/tools/giveaways/new" });
    expect(decidePublicRoute(`/herramientas/sorteos/${ID}`, "public")).toEqual({
      kind: "rewrite",
      to: `/es/tools/giveaways/${ID}`,
    });
  });

  it("passes English public URLs as they are", () => {
    expect(decidePublicRoute("/en", "anon")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/en/tools", "anon")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/en/start", "member")).toEqual({ kind: "pass" });
  });

  it("redirects direct visits to the internal /es tree to the canonical URL (308)", () => {
    expect(decidePublicRoute("/es/tools", "anon")).toEqual({ kind: "redirect", to: "/herramientas" });
    expect(decidePublicRoute("/es", "anon")).toEqual({ kind: "redirect", to: "/" });
    expect(decidePublicRoute("/es/start", "member")).toEqual({ kind: "redirect", to: "/start" });
  });

  it("lets the internal OG/Twitter images through at any depth", () => {
    expect(decidePublicRoute("/es/start/opengraph-image", "anon")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/es/start/twitter-image", "anon")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/es/start/opengraph-image-1a2b3c", "anon")).toEqual({ kind: "pass" });
    expect(decidePublicRoute(`/es/tools/giveaways/${ID}/opengraph-image`, "anon")).toEqual({ kind: "pass" });
  });

  it("ignores everything else (forum, unknown, invalid ids)", () => {
    expect(decidePublicRoute("/c/abc", "anon")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/sorteos", "member")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/herramientas/sorteos/not-a-uuid", "anon")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/xx", "anon")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/en/herramientas", "anon")).toEqual({ kind: "pass" });
  });
});

describe("decidePublicRoute: /donar and /pay (P3)", () => {
  it("/donar is the club page for a member and the public page for everyone else", () => {
    expect(decidePublicRoute("/donar", "member")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/donar", "anon")).toEqual({ kind: "rewrite", to: "/es/donate" });
    expect(decidePublicRoute("/donar", "public")).toEqual({ kind: "rewrite", to: "/es/donate" });
  });

  it("redirects /es/donate to /donar and passes /en/donate", () => {
    expect(decidePublicRoute("/es/donate", "anon")).toEqual({ kind: "redirect", to: "/donar" });
    expect(decidePublicRoute("/en/donate", "anon")).toEqual({ kind: "pass" });
  });

  it("rewrites the Spanish pay URLs and ignores invalid ones", () => {
    expect(decidePublicRoute("/herramientas/pay", "anon")).toEqual({ kind: "rewrite", to: "/es/tools/pay" });
    expect(decidePublicRoute("/pay/rayelus", "member")).toEqual({ kind: "rewrite", to: "/es/pay/rayelus" });
    expect(decidePublicRoute("/pay/ab", "anon")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/en/pay/rayelus", "anon")).toEqual({ kind: "pass" });
    expect(decidePublicRoute("/es/pay/rayelus", "anon")).toEqual({ kind: "redirect", to: "/pay/rayelus" });
  });

  it("lets the internal pay share cards through", () => {
    expect(decidePublicRoute("/es/pay/rayelus/opengraph-image", "anon")).toEqual({ kind: "pass" });
  });
});
