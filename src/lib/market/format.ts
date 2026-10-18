// Display-only formatting of market figures (plain JS numbers; never feeds money logic). es-ES, pinned in tests.
const DASH = "—";

const PRICE_BIG = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Under 1 USD keep up to 6 significant digits; maximumFractionDigits must be high enough not to clip tiny prices.
const PRICE_SMALL = new Intl.NumberFormat("es-ES", { maximumSignificantDigits: 6, maximumFractionDigits: 20 });
const COMPACT = new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 2 });
const PCT = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" });
const TIME = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" });

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

/** HH:MM in the runtime's es-ES locale and timezone. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? DASH : TIME.format(d);
}
