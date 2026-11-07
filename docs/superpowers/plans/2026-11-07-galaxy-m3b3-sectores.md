# Galaxy Survivor · M3b-3: sectores · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (decidido: ejecución directa, `feedback-direct-execution`). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Los sectores de la beta (GDD §5.5): 4 normales y 1 de temporada, cada uno con su bioma, su fauna y su Núcleo. Son unos 24 enemigos en las familias de §5.5, 5 jefes de sector y 1 de temporada. Los sectores se desbloquean venciendo al Núcleo del anterior, y el Hangar deja elegirlos.

**Architecture:**
- **Simulación** (`packages/sim`):
  - Cuatro comportamientos de enemigo nuevos (`orbit`, `support`, `blink`, `lancer`) y la debilidad elemental de los blindados.
  - Tres patrones de jefe nuevos (`wall`, `mines`, `blink`) con un registro de explosiones avisadas (`sim.blasts`).
  - El Núcleo profundo, que sustituye al jefe del sector cada 4 capas.
  - El bioma pasa a ser un catálogo cerrado.
  - Todos los números son datos. `SIM_VERSION` 1.3.0.
- **Reglas** (`packages/shared`): `sectors/unlocks.ts` evalúa los desbloqueos con las estadísticas de cada sector. La clave nueva de configuración viva `sectors` guarda las condiciones y el sector de temporada activo.
- **Base de datos:** la columna `galaxy.hangars.sector`, el sector elegido. Los desbloqueos se calculan con las partidas, como los de las sondas.
- **Servidor:**
  - `PUT /galaxy/api/hangar/sector`, solo para sectores abiertos;
  - `HangarView` con el sector elegido y el estado de cada sector;
  - `startRun` exige un sector abierto (`409 sector_locked`).
- **Web:**
  - 19 sprites de fauna, 5 de jefe y la decoración de 4 biomas nuevos;
  - la arena pinta cada bioma y los avisos nuevos (líneas, saltos, minas);
  - PERKINS presenta cada sector y cada Núcleo la primera vez;
  - el selector de sectores del Hangar.

**Tech Stack:** el de M3b-2 más una migración (Supabase/pgTAP).

**Spec:**
- `games/galaxy/docs/GDD.md`:
  - §5.5 (enemigos, jefes y sectores);
  - §5.6 (dificultad y calibración);
  - §13.1 y §13.1 bis (sector y Núcleo de temporada, contenido como datos y remezcla);
  - §15 (PERKINS por radio);
  - §17.3 y §17.5 (avisos, *juice*, pixel art);
  - §19 (M3b).
- `DESIGN_SYSTEM.md` §8 ter (Hangar) y §8 quater (arena).

## Decisiones de alcance (rulings del plan)

1. **Familias:** las 7 de §5.5 (enjambre, embestida, tirador, divisor, blindado, sanador o corruptor, invocador), que ya están en `ENEMY_FAMILIES`. El GDD dice «6 familias», pero enumera 7 papeles: mandan los papeles. Cada sector normal trae al menos 5 de las 7.
2. **Seis jefes:**
   - 4 Núcleos, uno por sector normal: `hive` (ya existe), `glacier`, `anemone` y `anvil`;
   - el **Núcleo profundo** `echo-core`, que aparece cada 4 capas (4, 8…) en los sectores normales;
   - el **Núcleo de temporada** `signal`.

   Con eso son «5 jefes de sector y 1 de temporada».
3. **Dificultad paralela:** los sectores no son cada vez más duros en la capa 1. Cada uno se calibra a la misma ventana (§5.6: capa 2–4 en 5–20 min con la build típica) y se distingue por sus mecánicas. La dureza sube con las capas, como hasta ahora. Todos los sectores dan el mismo botín, así que no cambian la economía ni sus cotas.
4. **Desbloqueo en cadena:**
   - Nebulosa Exterior está abierta.
   - Anillos de Escarcha se abre al vencer al Núcleo de la Nebulosa una vez, el Arrecife Hueco al vencer al de Escarcha, y la Forja Rota al vencer al del Arrecife.
   - Las condiciones son datos (`sectors.unlocks`): sector, estadística (`bossKills`, `maxDepth` o `extractions`) y valor. Se cuentan las partidas terminadas y no sospechosas de ese sector.
5. **Temporada:** el sector de temporada (`season: true` en el contenido) está abierto para todos mientras sea el `sectors.season` de la configuración viva; fuera de temporada sale bloqueado. Para la beta es `signal-rift`. La anomalía global, la ruta y la puntuación de temporada llegan con las temporadas (M7).
6. **El terreno es decoración:** cada bioma tiene su nebulosa, sus estrellas y sus rocas, y no hay obstáculos con colisión. Un terreno que choca pediría rutas para los enemigos y no lo exige el GDD.
7. **Élites:** se quedan las 3 de M3a (escudo, prisa y explosión), que cubren los ejemplos de §5.5.
8. **Sector elegido guardado en el servidor**, como la sonda. Si el elegido deja de estar abierto (fin de temporada), la vista del Hangar devuelve la Nebulosa Exterior.

## Global Constraints

Las de M3b-2 (rama `feature/galaxy-m3b3` desde `develop`, TDD, determinismo, contenido como datos, frontend con ui-ux-pro-max y DESIGN_SYSTEM, copy, CSP, BD local solo con `migration up` y `test db`, migración con fecha UTC). Además:
- Sprites a mano en rejillas de paleta (`sprites/types.ts`), escalado entero, contorno de 1 px y luz arriba a la izquierda. Los jefes miden 40×40 y pueden ser procedurales, como `hive()`. Los sprites llegan con su contenido o antes, porque el test que vigila que todo el contenido tenga sprite así lo exige.
- Cada aviso nuevo se ve antes de hacer daño: §17.3 y la regla de M3a de «patrones anunciados».

### Valores de partida

**Comportamientos nuevos** (los números son datos del enemigo):

| `kind` | Qué hace | Campos |
|---|---|---|
| `orbit` | Rodea a la sonda a `radius` girando a `turn` °/s y cada `every` s se lanza en línea recta durante `diveTime` | `radius`, `turn`, `every`, `diveSpeed`, `diveTime` |
| `support` | Se mantiene a `keep` u de la sonda y cada `cooldown` s cura (`heal`: fracción de vida máxima) o escuda (`shield`: fracción de vida máxima, con tope de 1 vida) a los aliados en `range`, sin contarse a sí mismo ni a los jefes | `effect: 'heal' \| 'shield'`, `amount`, `range`, `cooldown`, `keep` |
| `blink` | Se acerca andando; con la sonda a menos de `range`, marca un punto a `offset` u detrás de ella, espera `windup` s y salta allí | `range`, `offset`, `windup`, `cooldown` |
| `lancer` | Se queda a `range`, apunta mostrando una línea durante `windup` s y dispara un proyectil rápido en esa dirección | `range`, `windup`, `cooldown`, `bulletSpeed`, `bulletDamage` |
| `armored` (amplía) | `weakTo?: ElementId`: los golpes de ese elemento ignoran la reducción | — |

**Patrones de jefe nuevos:**

| `kind` | Qué hace | Campos |
|---|---|---|
| `wall` | Anillo de `count` balas con un hueco de `gap` ° en una dirección al azar | `count`, `gap`, `speed`, `damage` |
| `mines` | `count` círculos de aviso alrededor de la sonda (a menos de `spread` u); a los `delay` s explotan con `radius` y `damage` | `count`, `spread`, `radius`, `delay`, `damage` |
| `blink` | El jefe marca un punto a `offset` u de la sonda, desaparece `windup` s y reaparece allí con un anillo de `count` balas | `offset`, `windup`, `count`, `speed`, `damage` |

**Sectores, fauna y jefes:**

| Sector | id | Bioma | Fauna propia (id · nombre · familia · comportamiento) | Núcleo |
|---|---|---|---|---|
| Nebulosa Exterior | `outer-nebula` | `nebula` | las 6 de M3a | `hive` La Colmena Rota |
| Anillos de Escarcha | `frost-rings` | `ice` | `shard` Esquirla · enjambre · `chase` (rápida); `narwhal` Narval de escarcha · embestida · `charge` (alcance largo); `beacon` Faro gélido · tirador · `shooter` en anillo (8 balas, `spread` 360); `geode` Geoda · divisor · `chase`, se parte en 3 `shard`; `floe` Témpano · blindado · `armored`, `weakTo: 'burn'` | `glacier` La Madre Glaciar: `wall`, `aimed`, `summon` de `shard`, `spiral` |
| Arrecife Hueco | `hollow-reef` | `reef` | `polyp` Pólipo · enjambre · `orbit`; `jelly` Medusa de bruma · sanadora · `support` `heal`; `urchin` Erizo · tirador · `shooter` en abanico (5 púas); `eel` Anguila voltaica · tirador · `lancer`; `colony` Colonia · invocador · `summoner` de `polyp` | `anemone` La Anémona Rey: `summon` de `polyp`, `mines` (esporas), `radial`, `wall` |
| Forja Rota | `broken-forge` | `forge` | `ember` Ascua · enjambre · `chase`; `ram` Ariete · embestida · `charge`; `turret` Torreta corrupta · tirador · `lancer`; `golem` Gólem de escoria · blindado · `armored`, `weakTo: 'slow'`; `welder` Soldadora · corruptora · `support` `shield`; `crucible` Crisol · divisor · `chase`, se parte en 4 `ember` | `anvil` El Yunque: `charge`, `mines`, `wall`, `aimed` |
| Fisura de la Señal (temporada 1) | `signal-rift` | `rift` | `glitch` Glitch · embestida · `blink`; `wraith` Eco errante · invocador · `summoner` de `glitch`; `cantor` Cantor de estática · corruptor · `support` `shield`. Remezcla, con fauna de otros sectores: `shard` y `ram` | `signal` La Señal (Núcleo de temporada): `spiral`, `wall`, `blink`, `mines` |

En total son 25 enemigos y 6 jefes. El Núcleo profundo `echo-core` («El Eco Profundo», título «Núcleo abisal») mezcla un patrón de cada jefe en 3 fases y tiene un 50 % más de vida que `hive`. Lo declara el sector como `deepBoss: { boss: 'echo-core', every: 4 }`; la temporada no lo tiene.

Las estadísticas de cada especie parten de las de su familia en la Nebulosa (vida, velocidad, daño, radio y experiencia, ±30 %) y se ajustan en la calibración. Cada jefe parte de `hive` (vida 1200, 3 fases en 1 / 0,6 / 0,25).

**Configuración viva `sectors`:**
```
unlocks: { 'frost-rings': { sector: 'outer-nebula', stat: 'bossKills', value: 1 },
           'hollow-reef': { sector: 'frost-rings', stat: 'bossKills', value: 1 },
           'broken-forge': { sector: 'hollow-reef', stat: 'bossKills', value: 1 } }
season: 'signal-rift'   (o null: ninguna temporada abierta)
```

**Copy de los sectores:**

| Sector | Descripción |
|---|---|
| Anillos de Escarcha | «Hielo que canta cuando se rompe. La Estática lo ha vuelto cortante» |
| Arrecife Hueco | «Un arrecife que brilla en el vacío. Lo que parece vivo cura a lo que no debería» |
| Forja Rota | «Los talleres de una estación que nadie apagó. Todo aquí embiste o dispara» |
| Fisura de la Señal | «Una grieta por la que la Estática habla. Solo se abre esta temporada» |

Radio de PERKINS, la primera vez de cada sector y de cada Núcleo nuevos: una línea, sin punto final. Va en `copy.arena.radio.sectors[id]` y `copy.arena.radio.bosses[id]`. La Nebulosa y `hive` siguen con las líneas de M3a.

## Review Focus

1. **Un sector bloqueado, inexistente o fuera de temporada**, elegido o enviado al empezar: `409 sector_locked` o `400 invalid_input`, y nunca una partida allí → Tarea 7.
2. **`sectors.season` apuntando a un sector que no existe o que no es de temporada, o a `null`:** el Hangar se ve igual, nadie se queda sin sector y lanzar en la Nebulosa sigue funcionando → Tareas 6 y 7.
3. **Capas del Núcleo profundo (4, 8…):** aparece `echo-core` en vez del jefe del sector. Su caída abre la baliza, suelta el cofre y cuenta como jefe vencido igual que los demás, y la barra lleva su nombre → Tarea 2.
4. **Sanadoras y escudos:**
   - nunca curan por encima de la vida máxima, ni a los jefes, ni a los muertos;
   - el escudo no pasa de 1 vida;
   - dos sanadoras se curan entre sí pero no se hacen eternas: la curación tiene enfriamiento y el daño sigue ganando.

   → Tarea 1.
5. **Saltos y minas con varias sondas, la sonda muerta o en el borde:** apuntan a la sonda viva más cercana, sin NaN. La repetición con la misma semilla da el mismo hash → Tareas 1 y 2.

---

### Task 1: Comportamientos nuevos de enemigo

**Files:**
- Modify: `games/galaxy/packages/sim/src/content/{types,schema}.ts`. `Behavior` gana `orbit`, `support`, `blink` y `lancer`; `armored` gana `weakTo?`. El esquema los valida con referencias.
- Modify: `games/galaxy/packages/sim/src/systems/enemies.ts` (`behave`) y `games/galaxy/packages/sim/src/world/pools.ts`. El grupo de enemigos gana `tx` y `ty` (punto marcado) y `cd` (enfriamiento de habilidad), si no existe ya.
- Modify: `games/galaxy/packages/sim/src/systems/elements.ts` o `combat.ts`, donde se aplica la reducción del blindado: `weakTo`.
- Modify: `games/galaxy/packages/sim/src/events.ts`: `{ t: 'support'; x; y; range; effect }`, `{ t: 'blink'; fx; fy; tx; ty }` y `{ t: 'lance'; x; y; angle }`.
- Test: `games/galaxy/packages/sim/test/behaviors.test.ts` (nuevo).

**Interfaces:**
- Produces:
  - los tipos de comportamiento de la tabla;
  - `STATE.aim = 3`, el estado de la línea del `lancer` y del marcado del `blink` (los demás estados no cambian);
  - el enemigo expone `tx[i]` y `ty[i]` mientras está en `STATE.windup` o `STATE.aim`, para que la arena dibuje el aviso.

- [ ] **Step 1: Tests que fallan.** Usa `quietSim` con una especie de prueba para cada uno:
  - `orbit`: a los 2 s está a `radius ± 15 %` de la sonda y gira; cada `every` s se lanza, y su distancia baja más de 40 u en `diveTime`.
  - `support heal`:
    - un aliado con el 50 % de vida en `range` sube `amount` de su vida máxima;
    - uno con el 99 % no pasa del 100 %;
    - no cura a un jefe ni a sí misma;
    - no cura fuera de `range`;
    - con enfriamiento.
  - `support shield`: el escudo de un aliado sube `amount × vida máx` y nunca pasa de 1 vida máxima.
  - **Dos sanadoras enfrentadas a un daño constante mueren igual:** la curación de cada una es menor que el daño por segundo de prueba.
  - `blink`:
    - con la sonda a menos de `range`, entra en `STATE.aim` con `tx/ty` a `offset` u detrás de la sonda;
    - antes de `windup` no se ha movido;
    - después está en `tx/ty`;
    - emite `blink`.
  - `lancer`:
    - en `STATE.aim` no dispara durante `windup`;
    - luego sale un proyectil en la dirección marcada;
    - emite `lance` al empezar a apuntar.
  - `armored` con `weakTo: 'burn'`: un golpe de quemadura por delante hace el daño completo y uno sin elemento hace `1 − reduction`.
  - **Varias sondas y una muerta:** `blink` y `lancer` apuntan a la viva más cercana, y ninguna coordenada es NaN.
  - **Determinismo:** dos simulaciones con la misma semilla y entradas acaban con el mismo `stateHash`.
- [ ] **Step 2:** Ejecutar `pnpm -C games/galaxy exec vitest run --project unit packages/sim/test/behaviors.test.ts`. Esperado: FALLAN (tipos o comportamientos inexistentes).
- [ ] **Step 3: Implementar.**
  - Todo azar sale de `sim.rng.spawn` o `sim.rng.combat`, y toda trigonometría de la tabla.
  - Las curaciones buscan aliados con `enemiesNear`, que copia los candidatos.
  - Esquema: números positivos y `weakTo` en `ELEMENT_IDS`.
- [ ] **Step 4:** Ejecutar `pnpm -C games/galaxy exec vitest run --project unit packages/sim`. Esperado: todo PASA, incluidas las repeticiones de M3b-2.
- [ ] **Step 5: Commit** `feat(galaxy): comportamientos nuevos de enemigo`.

### Task 2: Patrones de jefe nuevos y Núcleo profundo

**Files:**
- Modify: `games/galaxy/packages/sim/src/content/{types,schema}.ts`:
  - `BossPattern` gana `wall`, `mines` y `blink`;
  - `SectorDef` gana `deepBoss: { boss: string; every: number } | null` y `season: boolean`;
  - `biome` pasa a ser `BiomeId` (`BIOMES = ['nebula', 'ice', 'reef', 'forge', 'rift']`).
- Modify: `games/galaxy/packages/sim/src/systems/boss.ts`:
  - `bossDef(sim)` elige `deepBoss` cuando `sim.layer % every === 0`;
  - `fire` aprende los tres patrones.
- Create: `games/galaxy/packages/sim/src/systems/blasts.ts`, con `sim.blasts: { x; y; radius; damage; at }[]` y `updateBlasts(sim)`. Se llama en el paso de la simulación después de los jefes; cada explosión hiere a las sondas en su radio con `hurtProbe` y emite `{ t: 'blast'; x; y; radius }`.
- Modify: `games/galaxy/packages/sim/src/summary.ts`: `stateHash` incluye `blasts`.
- Test: `games/galaxy/packages/sim/test/boss.test.ts`.

**Interfaces:**
- Consumes: `STATE.aim` y `tx/ty` (Tarea 1); el jefe usa los mismos campos para su `blink`.
- Produces: `BIOMES`, `BiomeId`, `sim.blasts` (lectura para la arena), y los eventos `blast` y `bossBlink { tx; ty }`.

- [ ] **Step 1: Tests que fallan:**
  - `wall` dispara `count` balas y ninguna en el hueco de `gap` °.
  - `mines`:
    - deja `count` explosiones a menos de `spread` de la sonda, y ninguna hace daño antes de `delay`;
    - a `delay` hiere a una sonda dentro del radio y no a una fuera;
    - se vacían.
  - `blink`: el jefe no recibe ni hace daño de contacto mientras desaparece (`windup`), reaparece en `tx/ty` y suelta un anillo de `count` balas.
  - **Núcleo profundo:**
    - con `every: 2`, la capa 2 trae `echo-core` y la 1 y la 3 el jefe del sector;
    - su caída abre la baliza, suelta el cofre, suma `bossKills` y emite `bossSpawn` con su id;
    - un sector con `deepBoss: null` nunca lo trae.
  - **El esquema rechaza:**
    - un `deepBoss` que no existe;
    - `every < 2`;
    - un bioma fuera de `BIOMES`.
  - **Determinismo:** dos simulaciones con `mines` y `blink`, la misma semilla y las mismas entradas dan el mismo hash.
- [ ] **Step 2:** Ejecutar `pnpm -C games/galaxy exec vitest run --project unit packages/sim/test/boss.test.ts`. Esperado: FALLAN.
- [ ] **Step 3: Implementar.** La Nebulosa Exterior recibe `deepBoss: { boss: 'echo-core', every: 4 }` y `season: false` cuando exista `echo-core` (Tarea 4). Hasta entonces `deepBoss: null`, para que el esquema pase.
- [ ] **Step 4:** Ejecutar `pnpm -C games/galaxy exec vitest run --project unit packages/sim`. Esperado: PASA.
- [ ] **Step 5: Commit** `feat(galaxy): patrones de jefe nuevos y Núcleo profundo`.

### Task 3: Sprites de la fauna, los jefes y los biomas

**Files:**
- Create: `games/galaxy/apps/web/src/arena/sprites/fauna2.ts`, con los 19 enemigos nuevos de la tabla y en los tamaños de su familia: enjambre 7–8 px, resto 12–16 px. Cada uno lleva su propio tono, con 2 fotogramas como los de M3a.
- Create: `games/galaxy/apps/web/src/arena/sprites/bosses.ts`, con `glacier`, `anemone`, `anvil`, `echo-core` y `signal` a 40×40, procedurales o a mano, con 2 fotogramas.
- Create: `games/galaxy/apps/web/src/arena/sprites/decor.ts`, con 3 rocas por bioma nuevo: `ice-1..3` (cristales), `coral-1..3`, `slag-1..3` (escoria con brasas) y `rift-1..3` (esquirlas de señal).
- Modify: `games/galaxy/apps/web/src/arena/sprites/index.ts`: las mete en `SPRITES`.
- Test: `games/galaxy/apps/web/test/sprites.test.ts`, que ya comprueba rejillas rectangulares, paleta y contenido con sprite.

**Interfaces:**
- Produces: los ids de sprite = los ids de la tabla de sectores (enemigos y jefes), más `<bioma>-1..3`.

- [ ] **Step 1: Test que falla** en `sprites.test.ts`: «cada especie y jefe de la tabla de M3b-3, y 3 rocas por bioma, tienen sprite». La lista de ids va escrita en el test, porque el contenido aún no existe.
- [ ] **Step 2:** Ejecutar `pnpm -C games/galaxy exec vitest run --project web apps/web/test/sprites.test.ts`. Esperado: FALLA.
- [ ] **Step 3:** Dibujar. La hoja de sprites a 4× (`arena.browser.test.ts`, `VITE_ARENA_SHOTS=1`) se revisa en una captura: se leen a 1× sobre el fondo y cada familia se reconoce por su silueta.
- [ ] **Step 4:** Ejecutar el test de Step 2 y el de la hoja. Esperado: PASAN, con la hoja revisada.
- [ ] **Step 5: Commit** `feat(galaxy): sprites de la fauna, los Núcleos y los biomas nuevos`.

### Task 4: Los cinco sectores en el contenido y su calibración

**Files:**
- Modify: `games/galaxy/packages/sim/src/content/default.ts`: 19 enemigos, 5 jefes y 4 sectores nuevos según la tabla.
  - Todos los sectores normales llevan `deepBoss: { boss: 'echo-core', every: 4 }`.
  - `signal-rift` lleva `season: true` y `deepBoss: null`.
- Modify: `games/galaxy/packages/sim/src/version.ts`: `SIM_VERSION = '1.3.0'`.
- Modify: `games/galaxy/packages/sim/test/{content,calibration}.test.ts`.

**Interfaces:**
- Consumes: Tareas 1–3.
- Produces: los ids de sector y bioma de la tabla, que leen las tareas 5–9.

- [ ] **Step 1: Tests que fallan** en `content.test.ts`:
  - 5 sectores con los ids y biomas de la tabla, 25 enemigos y 6 jefes;
  - cada sector normal tiene al menos 5 familias distintas en sus `spawns` y su propio Núcleo;
  - solo `signal-rift` es de temporada;
  - las 7 familias aparecen en el contenido;
  - cada comportamiento nuevo lo usa al menos una especie;
  - cada patrón nuevo lo usa al menos un jefe.

  En `calibration.test.ts`, bloque largo `GALAXY_CALIBRATE=1`: «cada sector llega a la capa 2–4 en 5–20 min (mediana de 8, Lumen y build típica)», con la `botRun` de M3b-2 y el sector como parámetro.
- [ ] **Step 2:** Ejecutar `pnpm -C games/galaxy exec vitest run --project unit packages/sim/test/content.test.ts`. Esperado: FALLA.
- [ ] **Step 3:** Escribir el contenido con los valores de partida.
- [ ] **Step 4:** Ejecutar `pnpm -C games/galaxy exec vitest run --project unit packages/sim` (PASA) y luego `GALAXY_CALIBRATE=1 pnpm -C games/galaxy exec vitest run --project unit packages/sim/test/calibration.test.ts` (PASA). Los ajustes de la calibración se apuntan en el registro como rulings con sus medianas.
- [ ] **Step 5: Commit** `feat(galaxy): cuatro sectores nuevos con su fauna y sus Núcleos`.

### Task 5: Biomas y avisos en la arena, y PERKINS en cada sector

**Files:**
- Create: `games/galaxy/apps/web/src/arena/stage/biomes.ts`, con `BIOME_LOOK: Record<BiomeId, { nebula: [string, string, string]; stars: [string, string, string]; rocks: string[]; dust: string }>`. La nebulosa son los tres tonos del ruido tramado; `nebula` conserva los colores de M3a.
- Modify:
  - `stage/terrain.ts`: `terrainAt(cx, cy, seed, biome)` elige las rocas del bioma;
  - `stage/stage.ts`: la textura de nebulosa y la de estrellas salen de `BIOME_LOOK[sim.sector.biome]`;
  - `stage/fx.ts`: dibuja los avisos nuevos.
- Avisos nuevos, todos en la capa `warnings` y en el color de los avisos de M3a:
  - la línea del `lancer` mientras apunta;
  - la marca del `blink` en `tx/ty`;
  - los círculos de `sim.blasts`, que se llenan hasta `delay`;
  - el pulso del `support`, verde si cura y violeta si escuda.
- Modify: `ArenaScreen.tsx`: `say('sector:' + id, …)` al empezar en un sector nuevo y `say('boss:' + id, …)` con el primer `bossSpawn` de cada Núcleo nuevo. También `copy/es.ts`.
- Modify: `docs/DESIGN_SYSTEM.md` §8 quater: biomas y avisos nuevos.
- Test:
  - `apps/web/test/terrain.test.ts`: cada bioma solo pone sus rocas y es determinista;
  - `apps/web/test/arena.test.tsx`: las líneas de radio salen una vez;
  - `apps/web/test/browser/arena.browser.test.ts`: una captura por bioma con fauna y avisos.

**Interfaces:**
- Consumes: `sim.sector.biome`, `BIOMES`, `sim.blasts`, `tx/ty`, `STATE.aim` y los eventos de las tareas 1–2.

- [ ] **Step 1: Tests que fallan:**
  - `terrainAt(…, 'ice')` solo devuelve rocas `ice-*` y es igual con la misma semilla;
  - la radio dice la línea de `frost-rings` al empezar allí la primera vez y no la segunda;
  - con el primer `bossSpawn` de `glacier` dice la suya.
- [ ] **Step 2:** Ejecutar `pnpm -C games/galaxy exec vitest run --project web apps/web/test/terrain.test.ts apps/web/test/arena.test.tsx`. Esperado: FALLAN.
- [ ] **Step 3:** Implementar, consultando antes ui-ux-pro-max (legibilidad de avisos sobre fondos de distinto tono). Los avisos de `mines` respetan `prefers-reduced-motion`: sin pulso, solo el llenado.
- [ ] **Step 4:** Ejecutar los tests y las capturas por bioma (`VITE_ARENA_SHOTS=1`), y revisarlas: fauna y balas se leen sobre cada fondo. Esperado: PASAN, con las capturas revisadas.
- [ ] **Step 5: Commit** `feat(galaxy): biomas, avisos nuevos y PERKINS en cada sector`.

### Task 6: Reglas de desbloqueo de sectores

**Files:**
- Create: `games/galaxy/packages/shared/src/sectors/unlocks.ts`:
  - `SectorStats = { bossKills; maxDepth; extractions }`;
  - `SectorCondition = { sector: string; stat: keyof SectorStats; value: number }`;
  - `sectorStatus(def: { id: string; season: boolean }, stats: Record<string, SectorStats>, cfg: SectorsConfig): { unlocked: boolean; condition: SectorCondition | null; progress: number; season: boolean }`.
- Modify: `games/galaxy/packages/shared/src/config/registry.ts`: clave `sectors` (estricta) con `unlocks` y `season` de los valores de partida; `season` es un id o `null`.
- Modify: `games/galaxy/packages/shared/src/api/runs.ts`:
  - `SectorCard` gana `biome`, `unlocked`, `condition`, `progress` y `season`;
  - `HangarView` gana `sector: string`;
  - `sectorChoiceSchema`.
- Modify: `games/galaxy/packages/shared/src/errors.ts`: `sector_locked`.
- Test: `games/galaxy/packages/shared/test/sectors.test.ts`.

**Interfaces:**
- Produces: `sectorStatus`, `SectorStats`, `SectorsConfig`, `sectorChoiceSchema` (`{ sector: contentId }`) y los campos nuevos de `SectorCard` y `HangarView`.

- [ ] **Step 1: Tests que fallan:**
  - Un sector sin condición y que no es de temporada está abierto.
  - `frost-rings` se abre cuando `stats['outer-nebula'].bossKills >= 1`, no antes; su `progress` es 0 y luego 1.
  - Una condición sobre un sector sin estadísticas da `progress` 0.
  - **Temporada:**
    - `signal-rift` está abierto con `season: 'signal-rift'`;
    - bloqueado y sin condición con `season: null` o con otro id;
    - un sector normal no se abre por ser el `season` de la configuración.
  - La clave rechaza valores ≤ 0, estadísticas desconocidas y campos de más.
  - Un `fast-check` comprueba que `progress` siempre está en [0, 1].
- [ ] **Step 2:** Ejecutar `pnpm -C games/galaxy exec vitest run --project unit packages/shared/test/sectors.test.ts`. Esperado: FALLAN.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Ejecutar `pnpm -C games/galaxy exec vitest run --project unit packages/shared`. Esperado: PASA.
- [ ] **Step 5: Commit** `feat(galaxy): reglas de desbloqueo de los sectores`.

### Task 7: Sector elegido y desbloqueos en el servidor

**Files:**
- Create: `supabase/migrations/<UTC>_galaxy_sectors.sql`: `alter table galaxy.hangars add column sector text not null default 'outer-nebula' check (sector ~ '^[a-z0-9-]{1,32}$')`. Los permisos de `galaxy_api` sobre la tabla ya existen; el test lo confirma.
- Create: `supabase/tests/975_galaxy_sectors.test.sql`.
- Modify: `games/galaxy/apps/server/src/runs/hangar.ts`:
  - `sectorStats(db, accountId): Promise<Record<string, SectorStats>>`, con las partidas terminadas y no sospechosas agrupadas por sector;
  - `sectorCards` con su estado;
  - la vista devuelve `sector`, el guardado si sigue abierto o si no `outer-nebula`.
- Create o modify: `games/galaxy/apps/server/src/runs/sectors.ts`: `chooseSector(deps, accountId, req)`.
- Modify: `games/galaxy/apps/server/src/runs/routes.ts`: `PUT /galaxy/api/hangar/sector`, con límite de frecuencia como el de la sonda.
- Modify: `games/galaxy/apps/server/src/runs/service.ts`: `startRun` devuelve `409 sector_locked` si el sector no está abierto.
- Test: `games/galaxy/apps/server/test/integration/sectors.test.ts` (nuevo).

**Interfaces:**
- Consumes: Tarea 6.
- Produces: el contrato HTTP `PUT /galaxy/api/hangar/sector { sector }` → `HangarView`, con 400 `invalid_input` y 409 `sector_locked`.

- [ ] **Step 1: Tests que fallan:**
  - pgTAP: la columna existe con su valor por defecto, rechaza `'Mal Id'`, y `galaxy_api` puede actualizarla.
  - **Integración:**
    - un hangar nuevo tiene `sector: 'outer-nebula'`, 5 cartas, `frost-rings` bloqueado con su condición y `signal-rift` abierto y de temporada;
    - elegir `frost-rings` da 409, y tras una partida terminada en la Nebulosa con `boss_kills: 1` da 200 y la vista lo trae elegido;
    - una partida sospechosa o sin terminar no cuenta;
    - elegir `nope` da 400;
    - `startRun` en un sector bloqueado da 409 y no crea partida.
  - **Temporada cambiada:** con `season: null` (configuración de prueba), la vista de quien tenía elegida la temporada vuelve a `outer-nebula`, `startRun` en `signal-rift` da 409, y lanzar en la Nebulosa sigue siendo 200.
  - **`season` apuntando a un sector inexistente o normal:** la vista no falla y la temporada sale bloqueada.
- [ ] **Step 2:** Aplicar la migración con `pnpm exec supabase migration up` y ejecutar `pnpm exec supabase test db` y `pnpm -C games/galaxy exec vitest run --project integration apps/server/test/integration/sectors.test.ts`. Esperado: FALLAN.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Ejecutar los mismos comandos y `pnpm -C games/galaxy exec vitest run --project integration`. Esperado: PASA, incluidos runs, hangar y probes.
- [ ] **Step 5: Commit** `feat(galaxy): sector elegido y desbloqueos en el servidor`.

### Task 8: Selector de sectores en el Hangar

**Files:**
- Modify: `games/galaxy/apps/web/src/hangar/HangarScreen.tsx`: un `SectorPanel`, como el `ProbePanel`.
  - **Arriba, el elegido:** nombre, descripción, el Núcleo con su sprite, la fauna, las capas y, si es de temporada, la insignia «Temporada» en Ultravioleta.
  - **Debajo, las losas de los 5 sectores:** el sprite de su Núcleo, el nombre y una línea.
    - Abierto: «Elegido» o «N especies».
    - Bloqueado: «Derrota a <Núcleo del sector de la condición>», con su barra 0/1.
    - Temporada cerrada: «Fuera de temporada».
  - Lanzar usa `view.sector`.
  - Se quita «Más sectores en desarrollo».
- Modify: `games/galaxy/apps/web/src/api/runs.ts`: `useChooseSector()`, que hace `setQueryData` con la vista.
- Modify: `games/galaxy/apps/web/src/copy/es.ts`, `src/styles/app.css` y `docs/DESIGN_SYSTEM.md` §8 ter.
- Test:
  - `apps/web/test/hangar.test.tsx`: fixture con los 5 sectores;
  - `apps/web/test/browser/hangar.browser.test.ts`: capturas a 1280, 1440, 1600 y 1920.

**Interfaces:**
- Consumes: Tareas 6 y 7.

- [ ] **Step 1: Tests que fallan:**
  - la lista «Sectores» tiene 5 elementos;
  - el elegido tiene `aria-pressed="true"`;
  - un bloqueado no es botón y dice «Derrota a La Colmena Rota» con su barra;
  - elegir otro abierto envía `PUT /hangar/sector` y la vista lo muestra;
  - Lanzar envía `sector: view.sector`;
  - un 409 `sector_locked` muestra su texto;
  - la temporada cerrada dice «Fuera de temporada».
- [ ] **Step 2:** Ejecutar `pnpm -C games/galaxy exec vitest run --project web apps/web/test/hangar.test.tsx`. Esperado: FALLAN.
- [ ] **Step 3:** Implementar, consultando antes ui-ux-pro-max. Las losas siguen la regla de las de las sondas (mínimo 168 px y dos columnas desde 1440 px).
- [ ] **Step 4:** Ejecutar la suite web y las capturas, y revisarlas. Esperado: PASAN.
- [ ] **Step 5: Commit** `feat(galaxy): selector de sectores en el Hangar`.

### Task 9: e2e, documentación, verificación, revisión final, PR y PRE

- [ ] **e2e de la incursión:** comprueba la lista «Sectores» (5, tres bloqueados con «Derrota a…») y lanza en la **Fisura de la Señal**, abierta por ser la temporada. Así recorre el bioma `rift` y su fauna en el build real.
- [ ] **DEPLOY_PRE paso 8:**
  - la migración `galaxy_sectors`;
  - la clave `sectors`;
  - `SIM_VERSION` 1.3.0;
  - el contenido viejo en la configuración deja de validar si alguien lo guardó;
  - qué comprobar.
- [ ] **Verificación completa:**
  - typecheck y lint;
  - `pnpm -C games/galaxy test`;
  - pgTAP;
  - `TZ=UTC pnpm test:unit` en la raíz;
  - todo el e2e;
  - build de Docker y smoke.
- [ ] **Cierre:** revisor nuevo (opus, `review-package`) y una pasada de correcciones con TDD. Después:
  - PR a `develop`, CI y fusión;
  - comprobación en PRE con una cuenta `e2e_pre_*`: Hangar, temporada, una partida en la Fisura y sin violaciones de CSP;
  - copiar el registro a `docs/superpowers/plans/2026-11-07-galaxy-m3b3-sectores.ledger.md` y borrar el espacio de trabajo;
  - memoria y informe.
