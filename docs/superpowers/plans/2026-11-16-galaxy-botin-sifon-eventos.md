# Galaxy Survivor: botín por sector, Sifón, castigo a quedarse quieto, eventos en partida y avisos

## Contexto

El propietario (16/11/2026) pide la siguiente tanda de mejoras. También hay que corregir o dejar apuntados todos los pendientes de las tandas anteriores.

1. **Botín por sector.** Hoy todos pagan lo mismo por minuto: es una regla del diseño original, con un test de ±15 %, y el servidor no distingue sectores. Así que todos farmean la Nebulosa. Además, la Fisura de la Señal debe abrirse a las 15 incursiones.
2. **Sifón.**
   - A nivel 5 cura el 5 % de todo el daño hecho, incluso el sobrante al matar, sin enfriamiento ni tope.
   - Entrada máxima de daño: el tope por golpe (40 % de la vida máxima) más 0,5 s de invulnerabilidad tras cada golpe permiten perder como mucho unas 0,8 barras de vida por segundo.
   - Por encima de unos 3.200 de daño por segundo, una sonda quieta no muere.
3. **Quedarse quieto** no tiene ningún castigo.
4. **Eventos.** Solo existe el satélite: como mucho 3 por partida, con poca respuesta en pantalla y sin distancia en el indicador del borde.
5. **Avisos.** Los de capa, Núcleo y baliza solo los lee el lector de pantalla; no se ven.

## Decisiones del propietario

| Tema | Decisión |
|---|---|
| Paga por sector (ajustable en el panel) | Nebulosa ×0,8 · Escarcha ×1 · Arrecife ×1,25 · Forja ×1,5 · Fisura ×1,8. Vale para monedas, polvo, material, componentes y puntos de temporada. |
| Experiencia por sector | El mismo multiplicador, pero **nunca por debajo de ×1**, para no frenar a los novatos. |
| Fisura | Se abre con **15 incursiones** (cualquier sector, de al menos 1 min, no sospechosas ni de prueba), siempre que la temporada la tenga abierta. **Quien ya terminó alguna incursión en la Fisura la conserva.** |
| Sifón | Solo cura del daño real, sin el sobrante, con un tope por segundo como % de la vida máxima: nivel 1 ≈ 1,4 %/s y nivel 5 = 3 %/s. Sin Sifón, la Sanguijuela y la Sangría curan como mucho **1 %/s**. Los botiquines no cambian. |
| Quieto | «La Estática te alcanza»: a los ~8 s en una zona pequeña sale un aviso; a los ~12 s, daño creciente y la curación bloqueada hasta salir. |
| Eventos | **8 eventos con variantes por sector**, unos 5–10 por partida de 25–30 min, con separación, guía en el borde con distancia y aviso de recompensa. |
| Botín de los eventos | Monedas, polvo y componentes, × el multiplicador del sector. Las señales siguen saliendo solo de los satélites (máximo 3). |
| Avisos | En el centro de la pantalla, desactivables en los ajustes de la incursión (activados por defecto). |
| Arte | **Todos los sprites nuevos con Aseprite**, en el estilo plano de 3 tonos de las sondas. |

## Orden de entrega

| PR | Contenido | SIM | ¿Publicar config? |
|---|---|---|---|
| A | Paga por sector y Fisura a las 15 incursiones | — | No: valores por defecto. |
| E1 | Pendientes del servidor y la web (c, d, e, a) | — | No |
| B0 | Pendientes de la simulación (f, g, b) y pruebas profundas (h, i) | 1.15.0 | No |
| B | Sifón y la Estática | 1.16.0 | No |
| D | Avisos en el centro y su ajuste | — | No |
| C1 | Motor de eventos, satélite mejorado, nave, cápsula, cazarrecompensas y límites en el servidor | 1.17.0 | Quizá `runs.caps.runComponents`, con tu OK |
| C2 | Meteoritos, tormenta, emboscada y pozo de gravedad | 1.18.0 | No |
| C3 | Sprites definitivos con Aseprite y variantes por sector | — | No |

**A va antes del 23/11**, cuando se publica la Temporada 2.

**Cada subida de la SIM:**
- regenera `packages/sim/test/golden-runs.ts`;
- lleva su entrada en `docs/DEPLOY_PRE.md`;
- añade los campos nuevos de contenido con `.default(D.x)`, para que el contenido publicado (v12) siga siendo válido y `contentSchema.parse({})` siga dando `DEFAULT_CONTENT`.

## PR A. Paga por sector y Fisura

**Configuración `sectors`** (`packages/shared/src/config/registry.ts:668`):
- `pay: record(sectorId, 0.1–3)`, por defecto `{ outer-nebula: 0.8, frost-rings: 1, hollow-reef: 1.25, broken-forge: 1.5, signal-rift: 1.8 }`. Un sector que falte vale 1.
- `seasonUnlock: { stat: 'runs', value } | null`, por defecto `{ runs, 15 }`.

**Migración:** `runs.sector_factor double precision not null default 1`, con un check entre 0 y 5. No se mezcla con `points_factor`, que tiene un check de ≤ 2. Actualizar `db/schema.ts`.

**Foto al empezar:** `startRun` (`apps/server/src/runs/service.ts`) y el alta en grupo (`coop/service.ts:123`) guardan `sector_factor`. Las incursiones que ya estén en marcha siguen con 1.

**Al cobrar (`settleRun` y `coop/settle.ts`):**
- `runPayout`, `runMaterial` y `runComponents` (`packages/shared/src/runs/rewards.ts`) aplican el factor después del recorte de verosimilitud.
- **Los topes por incursión se escalan con el factor.** Si no, una incursión honrada en la Fisura daría `payout_cap` y quedaría marcada como sospechosa.
- **Puntos:** `creditRunProgress` (`social/progress.ts`) aplica el factor tras el tope por minuto.
- **Experiencia:** `max(1, factor)`.
- **Ranking:** `social/leaderboard.ts:61` recalcula los puntos en SQL; tiene que usar `r.sector_factor` con la misma expresión que `creditRunProgress`, para que el ranking y los resultados no discrepen.
- **Pantallas:** `breakdown.sector = { id, factor }` (opcional) y una fila «Sector ×1,5» en `ResultsScreen.tsx`. En el hangar, una insignia de paga en cada sector.

**Fisura:**
- `sectorStatus` (`packages/shared/src/sectors/unlocks.ts`) recibe `totals.runs` (de `runStats(minRunSeconds)`) y si ya tiene una incursión terminada en ese sector.
- Se abre si la temporada la tiene abierta y (`runs ≥ 15` o ya la jugó).
- Hay que actualizar sus 4 llamadas: `service.ts`, `sectors.ts`, `room-routes.ts` y `hangar.ts`.
- Textos: `sectorUnlock.runs(n)` en `copy/es.ts`, `WherePanel.tsx` y las etiquetas de `admin/forms/labels.ts`.

**Tests primero:**
- `rewards`: el factor y los topes escalados;
- `sectors`: 14 cerrada, 15 abierta, la jugó y la conserva, temporada nula;
- `account`: la experiencia nunca baja de ×1;
- integración, solo en CI: el factor guardado, y el ranking igual a los puntos de los resultados.

**Documentación:**
- `CONTENIDO.md` y `SKILL.md:93`: la regla «paga igual» pasa a ser «botín igual en bruto; la paga la decide el sector».
- La calibración de ±15 % en la simulación se mantiene.

## PR E1. Pendientes del servidor y la web

- **(d)** Las incursiones de prueba ya no cuentan como «jugadas»: se filtran con `TEST_FLAG` en `onboarding/routes.ts:17`, `onboarding/tutorial.ts:27` y `coop/room-routes.ts:87`.
- **(c)** Al publicar el contenido se llama a `clearContentDraft()` (`ConfigScreen.tsx`). Test: «tras publicar no queda borrador».
- **(e)** La confirmación de prueba ya no queda debajo de la pausa:
  - `pause()` no actúa mientras se pregunta;
  - la pausa no se pinta mientras hay pregunta;
  - el Start del mando tampoco reanuda debajo de la confirmación (`ArenaScreen.tsx`).
- **(a)** La información de depuración se puede desplazar: `pointer-events: auto`, `overflow-y: auto` y altura máxima. Captura a 1280×720.

## PR B0. Pendientes de la simulación (SIM 1.15.0)

- **(f) `makeRoom`** (`systems/boss.ts`): quita fauna normal y nunca un élite, un inestable con la mecha encendida ni un enemigo enganchado. Elige el que esté más lejos de la sonda viva más cercana, no del centro del grupo.
- **(g) Techo de la vida por nivel:** nuevo `scaling.hpLevelMax`, por defecto 1000 (sin efecto), que se ve en `debugInfo`. El valor real se propone tras calibrar.
- **(b) `debugGrant`:** nuevo `rootOf()`, que sigue variante y evolución hasta la base, para no duplicar una familia.
- **(h) Pruebas profundas** en `golden-runs.ts` (`DEEP_RUNS`): capas de 40 s, pool pequeño (para forzar `makeRoom`) y `VETERAN`; una incursión en solitario y otra en grupo de 4, hasta las capas 5–7. Se comprueban en Node y en el navegador.
- **(i) Banco de pruebas del árbitro** (`packages/sim/test/bench/referee.bench.ts`): grupo de 4 en capa profunda con 400 enemigos, ms por paso (p50/p99).
  - Una orden de solo lectura, `bench-referee`, en la CLI.
  - Una medida permanente en `relay.ts` (`coop_cpu` p99).
  - **Ejecutarla en el servidor de casa necesita tu OK y una hora tranquila.**

## PR B. Sifón y la Estática (SIM 1.16.0)

**Contenido nuevo, con valores por defecto:**
- `healing: { base: 0.01, perLifesteal: 0.4, burst: 1 }`. El tope por segundo es `maxHp × (base + perLifesteal × lifesteal)`: Sifón nivel 1 ≈ 1,4 %/s, nivel 5 = 3 %/s; solo Sanguijuela o Sangría, 1 %/s.
- `stillness: { radius: 56, warn: 8, hurt: 12, damage: 0.02, growth: 0.02, max: 0.15 }`. El daño es una fracción de la vida máxima por segundo, crece cada segundo y tiene tope.

**Estado:**
- `ProbeState.still {x, y, t}` y `healBank`, **dentro del hash**; no van en `fx`, que no entra en el hash.
- Se reinician al revivir en grupo (`coop.ts`).

**Curación (`systems/healing.ts`), con `healProbe(sim, p, amount, 'steal' | 'other')`:**
- **Pasan por ella:**
  - el robo de vida (`combat.ts:75`), la Sanguijuela (`elements.ts:133`) y la Sangría (`reactions.ts:90`), las tres con el tope compartido;
  - la regeneración (`probes.ts:129`), los kits (`pickups.ts:85`) y la carta de curación (`upgrades.ts:90`).
- **No pasan:** subir la vida máxima, el segundo aliento, revivir y `debugHeal`.
- **Solo daño real:** `dealDamage` calcula lo absorbido más el mínimo entre el daño y la vida que quedaba, y devuelve ese valor. Eso también arregla la Sangría.
- **Con la curación bloqueada**, los kits no se atraen ni se recogen: se quedan en el suelo.

**Estática:**
- **Cuándo cuenta:** el ancla se mueve al salir del radio; el dash cuenta como salir. Solo cuentan las sondas vivas y en pie.
- **Se congela (no acumula):**
  - dentro de la baliza;
  - dentro de la zona de la nave;
  - cerca de un compañero caído;
  - con las cartas abiertas en grupo.
- **Daño:** propio, con una cola `loseLife()` compartida con `hurtProbe` que gestiona el segundo aliento, la caída en grupo y la muerte.
  - Respeta el modo invulnerable de depuración y consume el escudo.
  - Ignora la invulnerabilidad, la armadura y el tope por golpe, y no abre ventana de invulnerabilidad.
- **Eventos:** `static warn/start/stop` y `staticTick` cada 0,5 s (no `hurt` cada tick).
- **En pantalla:**
  - `HudSnapshot.still {level, left}`;
  - un anillo a trazos en el ancla que pasa a chisporroteo, con su sprite hecho en Aseprite;
  - la barra de vida marca «curación bloqueada»;
  - con movimiento reducido, sin pulso.

**Tests primero:**
- `healing.test.ts`: sin sobrante; tope por segundo; Sifón 1 contra 5; tope compartido; bloqueo; kits en el suelo.
- `stillness.test.ts`: aviso y daño, crecimiento, salir, cada caso de congelado, modo invulnerable, caer y revivir en grupo, morir pasando por el segundo aliento.

**Calibración** (como mucho 5 trabajos, prioridad Idle, `--maxWorkers=1`):
- **Perfiles nuevos:** `plantado` (no se mueve nunca), `campero` (se mueve ±20) y `sifon` (galaxias top y Sifón primero, con `botPickWith`, para no tocar `botPick` ni las partidas de referencia).
- **Objetivos:**
  - `plantado` y `campero` duran ≤ 25 % de `avanzado`;
  - `quieto` sigue en ≤ 60 % de `avanzado`;
  - `sifon` dura ≤ 1,15 × `avanzado`, sin combates atascados;
  - el orden de dificultad de los sectores se mantiene.

## PR D. Avisos en el centro

- **`arena/notices.ts` (puro):** cola de avisos, uno cada vez, unos 2,8 s cada uno.
  - Se ocultan con las cartas abiertas.
  - Van a ~38 % de la altura, sin tapar la barra del Núcleo ni las cartas.
  - Sin estilos en línea.
- **Primeros avisos:** «Avanzas a la capa X», «Hay un satélite cerca…», «+1 señal», el Núcleo, la baliza y el aviso de la Estática.
- **Accesibilidad:** el aviso visible lleva `aria-hidden`; la región para lectores de pantalla sigue leyéndolos aunque se apaguen.
- **Ajuste `runNotices` (por defecto activado):**
  - en `prefs.ts`, `sanitize`, `sync.ts` y `accountSettingsSchema`;
  - un interruptor en `ArenaSection`;
  - lo leen `ArenaScreen` y `CoopArena`.
- **Tests:** `notices.test.ts` y la sincronización del ajuste. Capturas a 1280, 1600, 1920 y 2560 px.

## PR C1. Motor de eventos y eventos de botín (SIM 1.17.0)

**Contenido `events`, con valores por defecto:**
- `slots` por capa: 35–120 s con un 85 % de probabilidad y 150–240 s con un 65 %.
- `gap: 40` y `endBy: 20` segundos.
- `weights` por tipo y `sectors` con las proporciones propias de cada sector.
- Parámetros de `wreck`, `capsule` y `bounty`: distancia, radio, segundos de saqueo, duración, botín base y `perLayer`.

**Cuántos salen:** unos 1,5 por capa; en 25–30 min (~4 capas) son unos 6 eventos más el satélite.

**Calendario:**
- `eventSchedule(seed, events, sector, layerSeconds)` es puro y usa su propio flujo por capa: `Rng.fromSeed(seed, 'events:'+L)`.
- Hace siempre el mismo número de tiradas, respeta la separación y termina antes del Núcleo.
- **El calendario del satélite (`worldSchedule`) no se toca.**

**Durante la partida:** `world.active[]`, dentro del hash.
- Solo en oleadas; se cierran al salir el Núcleo y al cambiar de capa.
- **Nave abandonada:** zona con progreso que avanza mientras haya una sonda dentro y suelta un cofre.
- **Cápsula:** aterrizaje avisado; se abre al tocarla.
- **Cazarrecompensas:** élite marcado (`bounty` en el pool) que huye; si lo matas, cofre.
- **Botín:** `floor(base × (1 + perLayer × (L−1)))`, sin suerte, para que el límite del servidor sea exacto.
- **Evento de la sim:** `worldEvent {kind, what, x, y, reward}`.
- **Depuración:** `debugEvent()`, para que un admin lance cualquier evento en una incursión de prueba.

**Servidor:**
- `eventLootUpTo(seed, content, sector, {depth, ticks, layerSeconds})`, calculado con el contenido con el que empezó la incursión.
- `checkRun` suma esa cantidad a los topes de monedas, polvo y componentes: el botín honrado no se recorta y el falso se marca `loot_cap`.
- Revisar si `caps.runComponents` (30) se queda corto. **Cambiarlo es publicar `runs`: con tu OK y la skill de publicar.**

**En pantalla:**
- `HudSnapshot.events` (hasta 3).
- Un `EventMarker` genérico **con distancia** sustituye a `SatelliteMarker`.
- Aviso de recompensa al completar («Nave saqueada: +34 monedas, +12 polvo»). El satélite gana también aparición, ruptura y su aviso.

**Tests primero:**
- en 200 semillas, la media es 5–10 eventos en 4 capas, con separación y nada durante el Núcleo;
- el calendario del satélite queda idéntico;
- el botín coincide con el límite del servidor;
- verosimilitud: lo honrado no se recorta y lo falso sí;
- `tinyContent` con `slots: []`.

**Calibración:** volver a medir el botín por minuto por sector.

## PR C2. Peligros (SIM 1.18.0)

- **Lluvia de meteoritos:** impactos avisados con `Blast` y un aviso nuevo `meteor`, cerca de cada sonda, que pasan por `hurtProbe` (tope por golpe e invulnerabilidad).
- **Tormenta de la Estática:** círculo que se desplaza más despacio que la sonda y hace daño cada 0,5 s.
- **Emboscada:** anillo avisado de la fauna del sector; si el pool está lleno, salen menos.
- **Pozo de gravedad:** atrae a las sondas (se puede escapar) y al botín.
- **Nombres por sector:** cada uno viste el evento con sus nombres (meteoritos, granizo, esporas, escoria o descargas). **Te los propongo como pregunta con opciones** antes de fijarlos.
- **Calibración con eventos:**
  - el novato en la Nebulosa sigue en 12 ± 2 min;
  - medio, veterano y avanzado, sin combates atascados;
  - quieto;
  - el botín por minuto;
  - volver a pasar el banco de pruebas del árbitro (la emboscada añade enemigos).

## PR C3. Arte con Aseprite

- Sprites nuevos hechos con el MCP de Aseprite y pasados a `sprites/events.ts`: nave, cápsula, cazarrecompensas, meteorito, tormenta, pozo y anillo de la Estática.
- Estilo plano de 3 tonos, contorno `#0b0c24` y luz desde arriba a la izquierda.
- Variantes por sector con cambio de paleta.
- Capturas con `VITE_ARENA_SHOTS=1` a 1280, 1600, 1920 y 2560 px.

## Notas de versión y documentación

- Una entrada en `packages/shared/src/notes/entries.ts` por cada entrega que vean los jugadores (A, B, D y C), sin cifras ajustables en el texto.
- `CONTENIDO.md` (eventos, Estática, paga por sector) y las skills `galaxy-enemigos-sectores-sondas` y `galaxy-habilidad` (regla de curación).

## Forma de trabajo

- Worktree `elclublambo-c7` desde `origin/develop`; ramas por PR.
- TDD; commits en español con las líneas de atribución.
- PR a `develop`, CI en verde, integrar y vigilar el despliegue `preproduction`. Nunca `main`.
- Ejecución directa: una revisión independiente de todo al final de cada bloque grande (A+E1, B0+B, D+C).

## Verificación

- **En local, solo lo que toca cada PR:**
  - `vitest --project unit|web` de los archivos cambiados;
  - toda `packages/sim/test` en cada subida de la SIM;
  - `tsc` y `eslint`.
- **Nunca en local:** integración, `db reset`, `db:test`, el e2e de la raíz ni `config.test.ts`. La CI es la puerta.
- **Calibraciones** con `GALAXY_CALIBRATE=1`, en cola de prioridad baja (≤ 5 trabajos).
- **Capturas** del aviso, los marcadores, el anillo de la Estática y los eventos, antes de dar nada por hecho.
- **En PRE lo pruebas tú:**
  - Forja contra Nebulosa en resultados;
  - Fisura cerrada o abierta según tus incursiones;
  - Sifón al máximo, que ya no es inmortal;
  - quedarse quieto activa la Estática;
  - eventos, que se pueden forzar desde el menú F2;
  - avisos y su interruptor.
