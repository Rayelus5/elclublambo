# Lanzamiento de la rareza Mítica

Plan «torneo, Temporada 2, Mítica y referidos», fase 4 (M1). El código de la rareza Mítica (#177) ya está en PRE, pero hasta ahora no puede salir: su probabilidad viva es 0. Esta carpeta la activa y le da sus valores propios donde lo vivo aún tenía los de 5 rarezas.

| Clave | Cambio |
|---|---|
| `gacha` v3 → v4 | `mythic`: 0 → **0,0005** (0,05 %), en su propia tirada antes de la normal. La garantía nunca da una mítica; una mítica también reinicia la garantía de legendaria |
| `content` v6 → v7 | `relics.tier` gana el sexto valor: **×1,9** para una mítica equipada como reliquia (sin él, valía como una legendaria, ×1,75). Sale de `draft-config content relics` y, comparado campo a campo con lo vivo, es el único cambio |
| `market` v4 → v5 | `minPrice.mythic`: **15.000**. Las míticas siguen sin poder venderse (`mythicListing` apagado); este suelo solo cuenta si un día se activa |

`galaxies` (polvo al desintegrar: 500) y `planetarium` (prestigio: 20) nunca se han publicado, así que ya usan los valores del código para la mítica. No hace falta tocarlos.

**Orden de publicación:** `content`, `gacha`, `market`. Sin aviso: la nota de versión 1.18 ya lo cuenta.

**`check-config`** avisa además de que `primer-contacto` no cabe en `season-1`. Es el aviso conocido de la Beta Abierta, que acaba esta noche, y esta carpeta no lo toca.

**Solo hacia delante:** con estas claves publicadas, volver al código de antes de #177 haría que `gacha` y `market` no validaran y volvieran a los valores del código. Si algo sale mal, se arregla publicando de nuevo, no revirtiendo el código.

Lo valida `packages/shared/test/launch-config.test.ts`.

## Publicado

**El 2026-11-13 a las 13:22 (hora de Madrid)**, con el OK del propietario en esta conversación.
- **Versiones:** `content` v6 → v7, `gacha` v3 → v4, `market` v4 → v5.
- **Justo antes:** `check-config` dijo lo mismo que aquí, con el aviso conocido de `primer-contacto`.
- **Motivo:** «Lanzamiento de la rareza Mítica, por orden del propietario».
- **Comprobado:**
  - `show-config` da `gacha.mythic` 0,0005, `market.minPrice.mythic` 15.000 y `relics.tier` con seis valores;
  - la salud responde `{"ok":true,"db":"up"}`;
  - el contenedor no dejó errores.
- **Para volver atrás:** lo de antes está en `antes/`.

