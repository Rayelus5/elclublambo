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

describe("paleta de Base: valores exactos", () => {
  it("coincide con la paleta aprobada (R2-R1..R4)", () => {
    expect(colors).toMatchObject({
      bg: "#0A0B0D",
      surface: "#121418",
      surface2: "#1A1D22",
      border: "#24272D",
      borderStrong: "#32353D",
      fg: "#EEF0F3",
      fgMuted: "#B1B7C3",
      accent: "#3C8AFF",
      accentFill: "#0000FF",
      accentFillFg: "#FFFFFF",
      success: "#66C800",
      warning: "#FFD12F",
      danger: "#FC401F",
      chart1: "#3C8AFF",
      chart2: "#66C800",
      chart3: "#FFD12F",
      chart4: "#FEA8CD",
      chart5: "#B8A581",
      chartRest: "#717886",
    });
  });
  it("el acento nunca es Base Blue (2,3:1 sobre oscuro)", () => {
    expect(colors.accent.toUpperCase()).not.toBe("#0000FF");
  });
});

describe("design tokens contrast (>= 4.5)", () => {
  const surfaces: Array<[string, string]> = [
    ["bg", colors.bg],
    ["surface", colors.surface],
    ["surface-2", colors.surface2],
  ];
  const texts: Array<[string, string]> = [
    ["fg", colors.fg],
    ["fg-muted", colors.fgMuted],
    ["accent", colors.accent],
  ];
  const textPairs = texts.flatMap(([tn, t]) => surfaces.map(([sn, s]) => [`${tn}/${sn}`, t, s] as [string, string, string]));
  const pairs: Array<[string, string, string]> = [
    ...textPairs,
    ["accent-fill-fg on accent-fill", colors.accentFillFg, colors.accentFill],
    ["bg on accent", colors.bg, colors.accent],
    ["danger/bg", colors.danger, colors.bg],
    ["success/bg", colors.success, colors.bg],
    ["warning/bg", colors.warning, colors.bg],
  ];
  it.each(pairs)("%s", (_n, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("focus ring / UI components (>= 3)", () => {
  it.each([
    ["accent/bg", colors.bg],
    ["accent/surface", colors.surface],
  ])("%s", (_n, bg) => {
    expect(contrastRatio(colors.accent, bg)).toBeGreaterThanOrEqual(3);
  });
});

describe("chart colours: non-text graphics need >= 3:1 on the panel (WCAG 1.4.11)", () => {
  const chart = [colors.chart1, colors.chart2, colors.chart3, colors.chart4, colors.chart5, colors.chartRest];
  it.each(chart)("%s on surface", (hex) => {
    expect(contrastRatio(hex, colors.surface)).toBeGreaterThanOrEqual(3);
  });
  it("are all distinct", () => {
    expect(new Set(chart.map((c) => c.toLowerCase())).size).toBe(chart.length);
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
