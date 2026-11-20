# La Estática crece contigo

Petición del propietario del 15/11: «un jugador normal avanzado … es capaz de quedarse quieto el 80 % de la incursión y no le supone ningún esfuerzo farmear». Quiere que la vida de los enemigos y de los Núcleos crezca bastante más durante la incursión, también con el nivel; que cada Núcleo tenga más vida que el anterior; que el daño suba poco a poco, sin que nada mate de un golpe; y más enemigos a la vez. El primer sector sigue siendo el más fácil y cada sector es un poco más difícil que el anterior. El propietario dio su OK a todo el cambio el 15/11.

**Necesita el código de #199 y #200 desplegado (SIM 1.14.0).** Los campos `hpPerLevel`, `levelFrom`, `coreHpPerLevel`, `coreRise`, `density.perLayer` y `hitCap` no existen en el esquema anterior.

**`content.json`:** solo `enemies`, `bosses`, `sectors` y `hitCap`, armados en PRE con `draft-config` desde el código desplegado (`--ids` con todas las entradas de cada lista). El resto de `content` no cambia.

**Se conservan dos ajustes hechos en vivo** que el código no tiene: el daño de bala del Escupidor (`spitter`, 5; el código dice 9) y el daño del Caparazón (`shell`, 13; el código dice 16). El borrador los habría subido.

| Qué | Antes | Ahora |
|---|---|---|
| Vida base de los 25 enemigos | — | +10 % |
| Dureza de los sectores (`enemyHp`) | 1,05 · 1,1 · 1,15 · 1,2 · 1,3 | 0,9 · 1 · 1,08 · 1,15 · 1,25 |
| Vida por minuto en la Nebulosa | 0,09 | 0,06 |
| Vida por nivel (desde el nivel 22, compuesta) | — | ×1,12 por nivel (Escarcha 1,09, Arrecife 1,17) |
| Vida de los Núcleos por nivel (lineal) | — | +4,5 % por nivel desde el 22 |
| Cada Núcleo sobre el anterior | — | al menos +15 % |
| Vida por capa: fauna | 0,35 (Fisura 0,45) | 0,6 (Fisura 0,7) |
| Vida por capa: Núcleos | 0,5 | 0,35 |
| Vida base de los Núcleos profundos | 8800 | 3500 (el +15 % sobre el anterior manda) |
| Daño por capa | 0,15 (Fisura 0,3) | 0,35 (Fisura 0,5) |
| Más enemigos por capa (salvo con Núcleo) | — | +40 % por capa |
| Tope por golpe | — | 40 % de la vida máxima (ya activo desde el despliegue) |

**Calibración** (bot, 16 semillas, `packages/sim/test/difficulty.test.ts`, Nebulosa):

| Perfil | Antes | Ahora |
|---|---|---|
| Novato (sin galaxias) | 11,6 min, capa 2, vence el 1.er Núcleo 11/16 | ≈ 9,5 min, capa 2, 12/16 |
| Medio (Legendaria + Poco común) | 27,9 min, capa 6 | ≈ 13 min, capa 3 |
| Veterano (4 galaxias) | 41,2 min, capa 7 | ≈ 19 min, capa 4 |
| Avanzado (6 galaxias top) | 48,2 min, capa 8; Núcleos en 10–25 s | ≈ 26 min, capa 5; Núcleos en 24–76 s |
| Avanzado quieto el 80 % del tiempo | farmea | ≈ 13 min |

**`antes/content.json`:** lo que había (v11, leído el 15/11), para volver atrás.

Se publica con la skill galaxy-publicar-config.

## Publicado

- **Cuándo:** 15/11/2026 a las 20:25 (Madrid), con el OK del propietario y con el código de #199 y #200 ya desplegado.
- **Versión:** `content` v11 → v12, con el motivo «La Estatica crece contigo: vida por nivel, Nucleos crecientes, presion por capa (plan del 15/11, OK del propietario)».
- **Comprobado:** v12 tiene `hitCap` 0,4, la Nebulosa con `enemyHp` 0,9, vida por nivel 0,12 desde el nivel 22, `coreRise` 0,15 y `perLayer` 0,4; el Ácaro con 8,8 de vida; el Escupidor y el Caparazón con su daño en vivo (5 y 13); la salud está bien y el contenedor no registró errores.
- **`antes/content.json`:** la v11 tal como estaba justo antes, para volver atrás.
