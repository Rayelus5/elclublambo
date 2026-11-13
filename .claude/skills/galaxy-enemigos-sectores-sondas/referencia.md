# Referencia: fauna, Núcleos, sectores, biomas, anomalías y sondas

Rutas relativas a `games/galaxy/`. Los commits citados sirven de ejemplo real: `git show --stat <sha>`.

## Simulación

| Qué | Dónde |
|---|---|
| Tipos | `packages/sim/src/content/types.ts`: `ENEMY_FAMILIES`, `Behavior`, `BossPattern`, `BIOMES`, `Quirk`, `ELEMENT_IDS` (solo se añade al final) |
| Esquema | `packages/sim/src/content/schema.ts`: uniones de `behavior`, `bossPattern` y `quirk`; enum de élites; `superRefine` con las referencias |
| Datos | `packages/sim/src/content/default.ts`: `enemies`, `bosses`, `sectors` (`SECTOR_BASE`, `DEEP`), `anomalies`, `probes` |
| Comportamientos | `systems/enemies.ts` (switch de `behavior`, `ELITE_CODE`), `systems/boss.ts` (switch de patrones), `systems/director.ts` (apariciones, multiplicadores de anomalía), `systems/combat.ts` (muertes, botín, contagio), `systems/quirks.ts`, `systems/dash.ts` (el dash del jugador; la peculiaridad `dash` de Chispa lo mejora), `systems/props.ts` |
| Avisos | `packages/sim/src/events.ts` (`telegraph`) |

## Web

| Qué | Dónde |
|---|---|
| Fauna | `apps/web/src/arena/sprites/fauna2.ts` (`FAUNA2`, `draw`/`lit`) |
| Núcleos | `apps/web/src/arena/sprites/bosses.ts` (`BOSSES`, `core(fn, fps)`, 40×40) |
| Sondas | `apps/web/src/arena/sprites/probes.ts` (`PROBES`, 16×16), direcciones en `arena/sprites/rotate.ts` |
| Rocas y objetos rompibles | `arena/sprites/decor.ts` (`DECOR`), `arena/sprites/props.ts` (`PROPS`, `set('<bioma>', …)`) |
| Bioma | `apps/web/src/arena/stage/biomes.ts` (`BIOME_LOOK`), `stage/terrain.ts` |
| Avisos de ataque | `apps/web/src/arena/stage/warnings.ts` y `drawWarnings` en `stage.ts` |
| Color al morir | `stage.ts` › `KILL_COLOR` |
| Códice | `apps/web/src/codex/entries.ts`: `BEAST_TEXT`, `FIGHT`, `CORE_TEXT`, `SECTOR_TEXT`. Trata `'echo-core'` y `'signal-rift'` aparte |
| Radio de PERKINS | `apps/web/src/copy/es.ts`: `copy.arena.radio.sectors[id]`, `copy.arena.radio.bosses[id]` |
| Test de personalidad | `apps/web/src/copy/es.ts`: perfiles y `copy.probeTest.quirks` |
| Clasificación | `apps/web/src/social/LeaderboardScreen.tsx` busca sprites en `DEFAULT_CONTENT` |

## Configuración viva

| Clave | Qué |
|---|---|
| `sectors` | `unlocks[id]` (condición para abrir el sector) y `season` (el sector de temporada abierto a todos; `null` lo cierra). Es independiente de las fechas |
| `probes` | `unlocks[id] = { stat, value }` y `starterUnlock` |
| `season` | `anomaly`: la anomalía activa, que debe existir en `content.anomalies` |

Ambas en `packages/shared/src/config/registry.ts`. Desbloqueos en `packages/shared/src/sectors/unlocks.ts` y `packages/shared/src/probes/unlocks.ts` (`probeStatus`).

## Tests

| Test | Qué fija |
|---|---|
| `packages/sim/test/content.test.ts` | 25 enemigos; cada sector normal con 5 familias o más; listas de Núcleos, sectores, biomas y sondas |
| `behaviors.test.ts`, `enemies.test.ts`, `boss.test.ts`, `anomalies.test.ts` (lista exacta), `quirks.test.ts` (lista exacta) | La mecánica de cada tipo |
| `sector-difficulty.test.ts` | `enemyHp` crece; el de temporada, el más duro; ≤1,35; el contenido viejo sin estos campos juega con 1 |
| `calibration.test.ts` | Paga lo mismo ±15 %; capas 2–4; «tres sondas iniciales» |
| `golden.test.ts` | Partidas de referencia |
| `apps/web/test/sprites.test.ts` (`M3B3_CORES`, `M3B3_ROCKS`), `terrain.test.ts`, `codex.test.ts`, `sprite-rotation.test.ts` | Sprites, terreno, Códice y rotación de sondas |
| `apps/server/test/integration/hangar.test.ts` (fauna de la Nebulosa Exterior), `probes.test.ts` (8), `sectors.test.ts` (5), `anomaly.test.ts` | Servidor (los pasa CI) |

## Ejemplos en el historial

| Commit | Qué añadió |
|---|---|
| 3af70177 | Cuatro sectores (datos) |
| 2f5d94e1 | Sprites |
| a8bd6838 | Biomas y PERKINS |
| 557357df | Dureza por sector |
| 4bc527c9 | Campo de botín con valores por defecto |
| 51492432 | Comportamiento nuevo |
| dda29b85 | Mecánica de anomalía |
| 7eee6cde | Sondas y rasgos |
| 6a44931c | Sprites de sondas |
