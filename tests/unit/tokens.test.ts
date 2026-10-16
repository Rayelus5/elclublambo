import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { colors, contrastRatio } from "@/styles/tokens";

describe("contrastRatio", () => {
  it("matches WCAG extremes", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });
});

describe("design tokens contrast (>= 4.5)", () => {
  const pairs: Array<[string, string, string]> = [
    ["fg/bg", colors.fg, colors.bg],
    ["fg-muted/bg", colors.fgMuted, colors.bg],
    ["fg-muted/surface-2", colors.fgMuted, colors.surface2],
    ["bg on accent", colors.bg, colors.accent],
    ["danger/bg", colors.danger, colors.bg],
    ["success/bg", colors.success, colors.bg],
    ["warning/bg", colors.warning, colors.bg],
    ["accent/bg", colors.accent, colors.bg],
  ];
  it.each(pairs)("%s", (_n, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("globals.css sync", () => {
  const css = readFileSync(
    join(process.cwd(), "src/app/globals.css"),
    "utf8",
  ).toLowerCase();
  it.each(Object.entries(colors))("token %s present", (_k, hex) => {
    expect(css).toContain(hex.toLowerCase());
  });
});
