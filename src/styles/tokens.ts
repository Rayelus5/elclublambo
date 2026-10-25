/** Fuente de verdad de los colores (spec §1). globals.css debe reflejar estos valores. */
export const colors = {
  bg: "#0A0B0D",
  surface: "#121418",
  surface2: "#1A1D22",
  border: "#24272D",
  borderStrong: "#32353D",
  fg: "#EEF0F3",
  fgMuted: "#B1B7C3",
  accent: "#3C8AFF",
  // Relleno (botones, chips): Base Blue con texto blanco. Nunca como texto, borde o anillo sobre oscuro.
  accentFill: "#0000FF",
  accentFillFg: "#FFFFFF",
  success: "#66C800",
  warning: "#FFD12F",
  danger: "#FC401F",
  // Chart series (DAO donut): distinct hues, none reusing a semantic colour; "rest" is the neutral slice.
  chart1: "#3C8AFF",
  chart2: "#66C800",
  chart3: "#FFD12F",
  chart4: "#FEA8CD",
  chart5: "#B8A581",
  chartRest: "#717886",
} as const;

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const digits = m?.[1];
  if (!digits) throw new Error(`Invalid hex color: ${hex}`);
  const n = parseInt(digits, 16);
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ratio de contraste WCAG 2.x entre dos colores hex (1–21). */
export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
