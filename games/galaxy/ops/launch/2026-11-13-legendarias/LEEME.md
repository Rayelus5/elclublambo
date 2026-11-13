# Legendarias y supernova más justas

Plan «torneo, Temporada 2, Mítica y referidos», fase 0 (O2). El propietario: las legendarias, sobre todo la supernova, están muy rotas en las incursiones. El código (`DEFAULT_CONTENT`, #169, nota de versión 1.13) ya está en PRE; esta carpeta lleva los mismos números a la configuración viva.

**`content.json` (`relics`):** sale de `draft-config content relics`, así que es el bloque entero del código. Comparado campo a campo con lo vivo, solo cambian cuatro valores:

| Campo | Antes | Ahora |
|---|---|---|
| `phenomena.supernova.damage` | 40 | 26 |
| `phenomena.supernova.radius` | 120 | 90 |
| `phenomena.supernova.cooldown` | 8 s | 10 s |
| `tier` (legendaria) | ×2 | ×1,75 |

Una supernova legendaria normal pasa de 80 de daño en 180 px cada 8 s a unos 46 en 124 px cada 10 s.

**Publicación:** solo la clave `content`.

**`check-config`** avisa además de que `primer-contacto` no cabe en `season-1`. Es el aviso conocido de la Beta Abierta, que acaba esta noche, y esta carpeta no lo toca.

Lo valida `packages/shared/test/launch-config.test.ts`.

## Publicado

**El 2026-11-13 a las 10:33 (hora de Madrid)**, con el OK del propietario en esta conversación.
- **Versión:** `content` v5 → v6.
- **Justo antes:** `check-config` dijo lo mismo que aquí (solo `relics`, con el aviso conocido de `primer-contacto`).
- **Motivo:** «Legendarias y supernova más justas, por orden del propietario».
- **Sin aviso:** el cambio va en la nota de versión 1.13.
- **Comprobado:**
  - `show-config content` da la v6 con los cuatro valores nuevos;
  - la salud responde `{"ok":true,"db":"up"}`;
  - el contenedor no dejó errores.
- **Para volver atrás:** el `content` entero de antes está en `antes/`.

