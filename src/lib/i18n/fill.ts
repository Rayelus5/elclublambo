/** "Cierra en {t}" + { t: "2 h" } -> "Cierra en 2 h". Unknown placeholders stay as they are. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

/** The date-time locale of each public language. */
export const DATE_LOCALE = { es: "es-ES", en: "en-GB" } as const;
