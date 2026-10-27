import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/onboarding/next-path";

describe("safeNextPath (onboarding)", () => {
  it("keeps a same-origin path", () => {
    expect(safeNextPath("/foro/c/abc")).toBe("/foro/c/abc");
    expect(safeNextPath("/foro/c/abc?x=1#y")).toBe("/foro/c/abc?x=1#y");
  });

  it.each([
    "//evil.com",
    "/\\evil",
    "https://evil.com",
    "/foro/bienvenida",
    "/foro/bienvenida?repetir=1",
    "/foro/bienvenida/x",
    "/bienvenida",
    "/foro/login",
    "/a\tb",
    "",
    null,
  ])("falls back to the club home (R1-R4) for %j", (raw) => {
    expect(safeNextPath(raw)).toBe("/foro");
  });
});
