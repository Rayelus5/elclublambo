/** "Cierra en {t}" + { t: "2 h" } -> "Cierra en 2 h". Unknown placeholders stay as they are. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

/** The date-time locale of each public language. */
export const DATE_LOCALE = { es: "es-ES", en: "en-GB" } as const;

/**
 * A plain decimal string ("0.06", "< 0.01", "1500") in the language's separator, for display only: a comma in Spanish,
 * the point in English. Inputs keep accepting both.
 */
export function localDecimal(text: string, lang: "es" | "en"): string {
  return lang === "es" ? text.replace(".", ",") : text;
}
