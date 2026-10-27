import type { Lang } from "./config";
import { es } from "./dictionaries/es";
import { en } from "./dictionaries/en";

export * from "./config";

// Las cadenas literales de `es` se ensanchan a `string`: `en` puede traducir,
// pero una clave que falte (o sobre) es un error de tipos.
type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Widen<U>[]
    : { -readonly [K in keyof T]: Widen<T[K]> };
export type Dictionary = Widen<typeof es>;

const dictionaries: Record<Lang, Dictionary> = { es, en };

export function getDictionary(lang: Lang): Dictionary {
  return dictionaries[lang];
}
