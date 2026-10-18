import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/onboarding/next-path";

describe("safeNextPath (onboarding)", () => {
  it("keeps a same-origin path", () => {
    expect(safeNextPath("/c/abc")).toBe("/c/abc");
    expect(safeNextPath("/c/abc?x=1#y")).toBe("/c/abc?x=1#y");
  });

  it.each(["//evil.com", "/\\evil", "https://evil.com", "/bienvenida", "/bienvenida?repetir=1", "/bienvenida/x", "/a\tb", "", null])(
    "falls back to / for %j",
    (raw) => {
      expect(safeNextPath(raw)).toBe("/");
    },
  );
});
