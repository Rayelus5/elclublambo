# Primer torneo

Plan «torneo, Temporada 2, Mítica y referidos», fase 0 (O1). La Temporada 1 es el torneo: del 13/11 al 22/11 incluido (en PRE, `season-1` va del 13/11 00:00 al 23/11 00:00, hora de Madrid; se cambió desde el panel y no hay carpeta de ese cambio). La Beta Abierta era para antes del torneo.

**`events.json`:**
- **Nuevo, el primero de la lista (el inicio enseña el primero en curso):** `primer-torneo`, «Primer torneo», del 13/11 00:00 al 23/11 00:00, con 10 metas personales.
- **`primer-contacto` (Beta Abierta):** acaba esta noche, el 14/11 a las 00:00, en vez del 24/11. Se cobra hasta entonces: las metas de un evento terminado ya no se pueden cobrar. Sus señales de evento sin usar pasan solas a polvo.
- **`escuadron-estelar` sale de la lista:** no había empezado (el 17/11), así que nadie pierde progreso. Vuelve en la Temporada 2.

| Meta | Objetivo | Premio |
|---|---|---|
| Juega 10 incursiones | 10 incursiones | 4 señales, 500 monedas, 100 puntos |
| Juega 150 minutos | 150 minutos | 5 señales, 300 de polvo, 100 puntos |
| Haz 30 escaneos | 30 escaneos | 5 señales, 300 de polvo, 100 puntos |
| Extrae 8 veces | 8 extracciones | 6 señales, 800 monedas, 150 puntos |
| Juega 6 partidas en grupo | 6 en grupo | 6 señales, 600 monedas, 150 puntos |
| Reanima a 8 compañeros | 8 reanimaciones | 5 señales, 400 de polvo, 100 puntos |
| Purga 10 Núcleos | 10 Núcleos | 7 señales, 500 de polvo, 200 puntos |
| Llega a la capa 5 | capa 5 | 8 señales, 1000 monedas, 200 puntos |
| Elimina 40.000 enemigos | 40.000 enemigos | 12 señales, Lumen de coral, 300 puntos |
| Purga 30 Núcleos | 30 Núcleos | 12 señales, Bastión de coral, 300 puntos |

En total, **70 señales de galaxia**, 1700 puntos de temporada (cuentan para el podio del torneo) y 2 skins Coral. Sin escáner propio: los premios son señales del Escáner profundo.

**`gacha.json`:** el escáner de la Beta Abierta (`primer-contacto`, supernovas destacadas) acaba con su evento, el 14/11 a las 00:00. `deep-scan` sigue igual.

**`catalog.json`:** los 5 premios de siempre (10, 25, 50, 75 y 100 %) no cambian, así nadie pierde lo que cobró. Entran 5 nuevos, cada uno con una skin Coral:

| Porcentaje | Skin |
|---|---|
| 15 % | Chispa de coral |
| 35 % | Vigía de coral |
| 60 % | Áncora de coral |
| 85 % | Prisma de coral |
| 95 % | Cometa de coral |

La de Eco va al evento de la Temporada 2.

**Orden de publicación:** `events`, `gacha`, `catalog` y el aviso:
- **Texto:** «Empieza el Primer torneo: metas duras, señales de galaxia y skins Coral. La Beta Abierta acaba esta noche a las 00:00: cobra lo que te quede».
- **Duración:** 1 día.

**`check-config`** avisa de que `primer-contacto` no cabe en `season-1`: empezó el 10/11, antes que la temporada. El aviso desaparece al acabar esta noche.

Lo valida `packages/shared/test/launch-config.test.ts`.

## Publicado

**El 2026-11-13 a las 09:55 (hora de Madrid)**, con el OK del propietario en esta conversación.
- **Versiones:** `events` v4 → v5, `gacha` v2 → v3, `catalog` v0 → v1.
- **Justo antes:** `check-config` dijo lo mismo que aquí, con el único problema esperado de `primer-contacto`.
- **Motivo:** «Primer torneo, cierre de la Beta Abierta y Catálogo con skins Coral, por orden del propietario».
- **Aviso:** el del texto de arriba, durante 1 día.
- **Comprobado:**
  - `show-config` da las tres versiones nuevas;
  - la salud responde `{"ok":true,"db":"up"}`;
  - el contenedor no dejó errores.
- **Para volver atrás:** lo de antes está en `antes/`.

