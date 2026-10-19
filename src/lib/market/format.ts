// Display-only formatting of market figures (plain JS numbers; never feeds money logic). es-ES, pinned in tests.
import { CHART_RANGES, type ChartRange } from "@/lib/market/types";

const DASH = "—";

const PRICE_BIG = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Under 1 USD keep up to 6 significant digits; maximumFractionDigits must be high enough not to clip tiny prices.
const PRICE_SMALL = new Intl.NumberFormat("es-ES", { maximumSignificantDigits: 6, maximumFractionDigits: 20 });
const COMPACT = new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 2 });
const PCT = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" });
const TIME_OPTS = { hour: "2-digit", minute: "2-digit" } as const;
const TIME_UTC = new Intl.DateTimeFormat("es-ES", { ...TIME_OPTS, timeZone: "UTC" });

export function formatPrice(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return DASH;
  return `${Math.abs(n) >= 1 ? PRICE_BIG.format(n) : PRICE_SMALL.format(n)} USD`;
}

export function formatCompactUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return DASH;
  return `${COMPACT.format(n)} USD`;
}

export function formatChange(n: number | null): { text: string; dir: "up" | "down" | "flat" } {
  if (n === null || !Number.isFinite(n)) return { text: DASH, dir: "flat" };
  const text = PCT.format(n);
  // Direction follows what is shown: -0.001 prints "0,00" and is flat.
  const dir = text.startsWith("+") ? "up" : text.startsWith("-") ? "down" : "flat";
  return { text: `${text} %`, dir };
}

export const RANGE_LABEL: Record<ChartRange, string> = { "1": "24 h", "7": "7 días", "30": "30 días", "365": "1 año" };

/** `?r=` to a valid chart range; anything unknown, repeated or empty falls back to 7 days. */
export function parseRange(v: string | string[] | undefined): ChartRange {
  return typeof v === "string" && (CHART_RANGES as readonly string[]).includes(v) ? (v as ChartRange) : "7";
}

const SUPPLY = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const DATE = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function formatSupply(n: number | null): string {
  return n === null || !Number.isFinite(n) ? DASH : SUPPLY.format(n);
}

export function formatDate(iso: string | null): string {
  if (iso === null) return DASH;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? DASH : DATE.format(d);
}

/**
 * HH:MM in es-ES: in the runtime's own time zone (the viewer's, when it runs in the browser), or in UTC with
 * `{ utc: true }` (stable server output; see LocalClock). The default-zone formatter is built per call so the zone in
 * effect at call time is used.
 */
export function formatTime(iso: string, opts: { utc?: boolean } = {}): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return opts.utc ? TIME_UTC.format(d) : new Intl.DateTimeFormat("es-ES", TIME_OPTS).format(d);
}
