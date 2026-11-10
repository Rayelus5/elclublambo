# Referencia: sitios que tocar en una habilidad

Las rutas son relativas a `games/galaxy/`. Los commits citados sirven como ejemplo real: `git show --stat <sha>`.

## Arma de un `kind` existente (solo datos)

| Qué | Dónde |
|---|---|
| Definición y niveles | `packages/sim/src/content/default.ts` › `weapons` (`levels({...})`) |
| Evolución | el mismo archivo: entrada con `evolution: { from, requires }`, un nivel, `special` e icono `<icono>-evo` |
| Variantes 4/8 (arma inicial) | `default.ts` › tabla `VARIANTS` (`variantOf`, `VariantSpec`) |
| Icono | `apps/web/src/arena/sprites/icons.ts` › `ICONS`, `EVOLVING`, `VARIANTS` (y `INKS` para un elemento nuevo) |
| Arte del Hangar | `art/weapons/paint-weapons.lua` → `apps/web/src/hangar/weapons/<id>.png`, cargado por `apps/web/src/hangar/weapons.ts` |
| Orden del bot (opcional) | `packages/sim/src/bot.ts` › `WEAPON_ORDER` |
| Textos | ninguno: nombre y descripción van en los datos; la carta de evolución usa `copy.arena.evolves` |

**Límites:** `weapons` admite 64 entradas (hoy 48); `levels()` da 5 niveles si no se le pasa otro número; los niveles tienen 11 campos obligatorios (`schema.ts`), que `levels()` rellena con 0.

**Tests:**
- `packages/sim/test/content.test.ts`, `upgrades.test.ts` (16), `weapons.test.ts`, `variants.test.ts` (16, proporción medida 0,75–1,25), `builds.test.ts`, `calibration.test.ts`, `golden.test.ts`;
- `apps/web/test/sprites.test.ts`, `weapon-art.test.ts` (24);
- `apps/web/test/browser/arena.browser.test.ts` («dibuja el arsenal»).

**Ejemplos:** 370c1e2c y bc2b00dd (simulación e iconos), cce2c726 (evoluciones), e26bec73 (variantes) y 1d43cc17 (arte de Aseprite).

## `kind` de arma nuevo (código)

Todo lo anterior, más:

| Qué | Dónde |
|---|---|
| Tipo | `packages/sim/src/content/types.ts` › `WEAPON_KINDS`, `SPECIALS` |
| Esquema | `packages/sim/src/content/schema.ts` (`.default()` en campos nuevos de objetos existentes) |
| Disparo | `packages/sim/src/systems/weapons.ts` (`SHOT`, `AREA`, `RADIUS`, `PERSISTENT`, `fireOnce`; declara `weaponHooks`) o `systems/arsenal.ts` (`fire`, `update`, `expire`, `pull`; rellena `weaponHooks`) |
| Estado por disparo | `packages/sim/src/world/pools.ts` › `SHOT_FIELDS`, `AREA_FIELDS` |
| Dibujo | `apps/web/src/arena/stage/stage.ts` › `SHOT_SPRITE` (índice = valor de `SHOT`), `ROTATES`, `drawShots`, `drawAreas` |
| Partículas | `apps/web/src/arena/stage/fx.ts` |
| Sprite del disparo | `apps/web/src/arena/sprites/items.ts` › `ITEMS`, más su id en la lista `engine` de `apps/web/test/sprites.test.ts` |
| Versión | `packages/sim/src/version.ts` › `SIM_VERSION`, más una entrada en `docs/DEPLOY_PRE.md` |

**Ejemplo:** cfd09edd (escenario, efectos y test de navegador).

## Pasiva

| Caso | Qué tocar |
|---|---|
| Con una stat existente | `default.ts` › `passives`, `ICONS['icon-<id>']`, `PASSIVE_ORDER` opcional; tests `content.test.ts` (20), `sprites.test.ts`, builds, calibración y referencia |
| Con una stat nueva | `types.ts` › `STAT_KEYS`; `systems/stats.ts` › `deriveStats` y el tipo `Stats` de `packages/sim/src/types.ts`; el sistema que la usa; `DEFAULT_CONTENT.caps`; `apps/web/src/admin/forms/labels.ts` › `VALUES`; `es.ts` › `hangar.statNames` y `LAB_STATS`; `stats.test.ts`. Ejemplo: 4ea06edf |

**Trampa de `caps`:** `caps` es `z.record(z.enum(STAT_KEYS), …)`, que en Zod 4 es exhaustivo. Añadir una stat hace inválido todo el `content` publicado, y el servidor vuelve a `DEFAULT_CONTENT` en silencio. Hay que dar a la stat nueva un tope por defecto que el contenido viejo acepte; por ejemplo, un esquema de `caps` con la clave opcional o con valor por defecto. Pruébalo con un test del estilo «un contenido publicado antes, sin esta stat, sigue valiendo» (patrón de `sector-difficulty.test.ts`).

## Retoque de números

- **Solo datos:** no sube `SIM_VERSION`, porque cada partida guarda su versión de contenido.
- **Comprobaciones:** calibración y builds.
- **Tests con valores literales:** actualízalos.
- **Para que llegue a PRE:**
  1. cambiarlo en `DEFAULT_CONTENT`;
  2. desplegar;
  3. volver a publicar con `draft-config content weapons --ids <id>` (sustituye solo esa arma y conserva el resto como está publicado).
