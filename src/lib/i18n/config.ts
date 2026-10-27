export type Lang = "es" | "en";

export const LANGS: readonly Lang[] = ["es", "en"];

export function isLang(v: string): v is Lang {
  return (LANGS as readonly string[]).includes(v);
}

export const OG_LOCALE: Record<Lang, "es_ES" | "en_US"> = {
  es: "es_ES",
  en: "en_US",
};
