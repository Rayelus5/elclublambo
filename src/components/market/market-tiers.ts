// Ruling F4b-R4: the table always fits its panel (never a sideways scroll, inside or outside). Columns appear in tiers
// by the PANEL's width (container queries), because the forum shell's sidebar and right rail make <main> narrower at
// 1024 px than at 768 px. Base (T-003, compact exchange-style rows on a phone): Cripto (logo, name over symbol and
// rank) and Precio (price over the 24 h change).
export const TIER_SM = "hidden @min-[26rem]:table-cell"; // #, 24 h as their own columns (panel ≥ 26rem: 768 px, 1024 px)
export const TIER_MD = "hidden @min-[38rem]:table-cell"; // 7 d, Capitalización (panel ≥ 38rem: fits at 1280 px with the rail)
export const TIER_LG = "hidden @3xl:table-cell"; // 7-day sparkline (≥ 48rem)
export const TIER_XL = "hidden @5xl:table-cell"; // 1 h, Volumen 24 h (≥ 64rem)
export const TH = "px-3 py-2 text-right text-[13px] font-bold text-fg-muted";
export const TD = "px-3 py-2 text-right tabular-nums";
