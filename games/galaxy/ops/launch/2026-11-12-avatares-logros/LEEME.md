# Avatares de los logros

Plan de mejoras de noviembre, C2. Los logros de PRE están publicados (`achievements` v1), así que los avatares que el código les da no llegan solos. Se publica con la skill `galaxy-publicar-config`, con el OK que el propietario dio para este plan. Necesita los cosméticos desplegados (PR #138).

**`achievements.json` (`list`):** los 14 logros de hoy, en el mismo orden e idénticos, salvo que cuatro dan además un avatar:

| Logro | Avatar |
|---|---|
| Primer despegue (`a-first-run`) | Lumen (`probe-lumen`) |
| Exterminador (`a-kills10k`) | Chispa (`probe-spark`) |
| Siempre vuelvo (`a-extract25`) | Bastión (`probe-bastion`) |
| Azote de Núcleos (`a-boss100`) | Fantasma de estática (`static-ghost`) |

`a-depth6` solo existe en lo vivo y queda tal cual. El borrador se hizo en PRE con `draft-config achievements list --ids a-first-run,a-kills10k,a-extract25,a-boss100`.

**Después de publicar:** `cosmetics-backfill` da el avatar a quien ya cobró esos logros. Se puede repetir sin dar nada dos veces.

Lo valida `packages/shared/test/launch-config.test.ts`.

## Publicado

**El 2026-11-12 hacia las 04:45 (hora de Madrid)**, con el OK que el propietario dio para este plan.
- **`achievements` v1 → v2.** `check-config`, repetido justo antes de publicar, dijo lo mismo: cambian los cuatro logros de arriba y «Se sostiene».
- **Motivo:** «Avatares en cuatro logros (Lumen, Chispa, Bastion y Fantasma de estatica)».
- **Sin aviso:** los avatares se ven en «Personalizar».
- **`cosmetics-backfill`** se volvió a lanzar: «Retratos revisados en 26 partidas · logros 20 · catálogo 10 · ruta 1».
- **Comprobado:** la salud responde `{"ok":true,"db":"up"}` y el contenedor no dejó errores.
- **Lo de antes** (v1) está en `antes/` para volver atrás. Un avatar ya dado no se quita al volver atrás.
