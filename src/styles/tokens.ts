/** Fuente de verdad de los colores (spec §1). globals.css debe reflejar estos valores. */
export const colors = {
  bg: "#0A0A0A",
  surface: "#111111",
  surface2: "#171717",
  border: "#262626",
  borderStrong: "#3A3A3A",
  fg: "#EDEDED",
  fgMuted: "#A3A3A3",
  accent: "#61DFFF",
  success: "#3DDC84",
  warning: "#FFB020",
  danger: "#FF5A5A",
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
