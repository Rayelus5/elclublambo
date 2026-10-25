import { describe, expect, it } from "vitest";
import { LEGACY_CLUB_SEGMENTS, isUnknownTopSegment, legacyClubRedirect } from "@/lib/i18n/public-routing";

// R1-R5: every top-level segment the club used before living under /foro.
const SEGMENTS = [
  "c",
  "u",
  "perfil",
  "sorteos",
  "dao",
  "mercado",
  "guia",
  "invites",
  "notifications",
  "tickets",
  "moderation",
  "admin",
  "settings",
  "login",
  "invite",
  "no-access",
  "banned",
  "bienvenida",
];

describe("LEGACY_CLUB_SEGMENTS", () => {
  it("is exactly the old club segments (R1-R5)", () => {
    expect([...LEGACY_CLUB_SEGMENTS].sort()).toEqual([...SEGMENTS].sort());
  });
});

describe("legacyClubRedirect", () => {
  it.each(SEGMENTS)("/%s goes under /foro, with and without a query", (seg) => {
    expect(legacyClubRedirect(`/${seg}`, "")).toBe(`/foro/${seg}`);
    expect(legacyClubRedirect(`/${seg}/x/y`, "?a=1&b=2")).toBe(`/foro/${seg}/x/y?a=1&b=2`);
  });

  it("keeps deep links intact", () => {
    expect(legacyClubRedirect("/c/abc", "?m=1&thread=2")).toBe("/foro/c/abc?m=1&thread=2");
    expect(legacyClubRedirect("/invite/Zx_9-a", "")).toBe("/foro/invite/Zx_9-a");
    expect(legacyClubRedirect("/login/complete", "?mode=public&next=%2F")).toBe("/foro/login/complete?mode=public&next=%2F");
    expect(legacyClubRedirect("/dao/tesoreria", "")).toBe("/foro/dao/tesoreria");
  });

  it("/donar exact is the public page; a /donar subpath was the club's", () => {
    expect(legacyClubRedirect("/donar", "")).toBeNull();
    expect(legacyClubRedirect("/donar", "?x=1")).toBeNull();
    expect(legacyClubRedirect("/donar/x", "?y=1")).toBe("/foro/donar/x?y=1");
  });

  it.each(["/", "/herramientas", "/herramientas/sorteos", "/en", "/en/donate", "/es", "/pay/x", "/start", "/api/v1/x", "/api/cron/dao", "/out", "/foro", "/foro/c/x", "/xx", "/cc", "/loginx"])(
    "%s is not redirected",
    (p) => {
      expect(legacyClubRedirect(p, "?q=1")).toBeNull();
    },
  );

  it("covers every old single segment before the unknown-segment 404", () => {
    for (const seg of SEGMENTS) {
      const p = `/${seg}`;
      expect(legacyClubRedirect(p, "") !== null || !isUnknownTopSegment(p)).toBe(true);
    }
  });
});
