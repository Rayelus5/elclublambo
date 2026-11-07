# Galaxy Survivor · M3b-2: sondas y test de la sonda · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (decidido: ejecución directa, `feedback-direct-execution`). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Las 8 sondas del juego (GDD §6): cada una con su sprite, arma inicial, estadística fuerte y peculiaridad. Al crear la cuenta, un test de personalidad de 5 preguntas (más una de desempate) te asigna una de las 3 sondas iniciales y te la presenta con un perfil. El resto se desbloquea jugando, y el Hangar deja elegir entre las desbloqueadas.

**Architecture:**
- **Simulación** (`packages/sim`): 7 `ProbeDef` nuevas y un campo `quirk` (peculiaridad) con 8 tipos de código en `systems/quirks.ts` (nuevo). Todos los números son datos.
- **Reglas** (`packages/shared`):
  - `probes/test.ts` puntúa el test, con su desempate, y es una función pura;
  - `probes/unlocks.ts` evalúa los desbloqueos con las estadísticas de partidas;
  - la clave nueva de configuración viva `probes` guarda las iniciales y las condiciones.
- **Base de datos:** `galaxy.probe_tests`, un test por cuenta que solo se escribe una vez. Los desbloqueos se calculan con las partidas no sospechosas; no tienen tabla propia.
- **Servidor:**
  - `POST /galaxy/api/probe-test` (idempotente: un segundo envío devuelve el resultado guardado);
  - `PUT /galaxy/api/hangar/probe` (solo sondas desbloqueadas);
  - `HangarView` con el estado del test y el progreso de cada sonda;
  - `startRun` exige el test hecho y la sonda desbloqueada.
- **Web:**
  - la pantalla `/sonda`: preguntas, desempate y revelado con perfil;
  - la puerta: tras crear la cuenta, y en el Hangar si falta el test;
  - el selector de sondas del Hangar;
  - 7 sprites nuevos.

**Tech Stack:** el de M3a/M3b-1 más una migración (Supabase/pgTAP).

**Spec:**
- `games/galaxy/docs/GDD.md`:
  - §6 (sondas, test, desbloqueos, mejoras);
  - §12.2 (onboarding, paso 2);
  - §5.6 (calibración);
  - §19 (M3b).
- `DESIGN_SYSTEM.md`.

## Decisiones de alcance (rulings del plan)

1. **Sin niveles de sonda ni laboratorio:** la mejora con componentes y monedas, y las variantes del arma en los niveles 4 y 8, llegan con la estación (M4), que trae los componentes.
2. **Desbloqueos por estadísticas de partidas no sospechosas:** jefes vencidos, capa máxima, extracciones, bajas totales e incursiones terminadas. Los logros (M7) podrán añadir otras condiciones sin cambiar el modelo.
   - Las dos iniciales que el test no te da también se desbloquean jugando, con condiciones fáciles.
3. **Cuentas ya creadas:** el Hangar les pide el test antes de lanzar, como a las nuevas. Hasta entonces el servidor no deja empezar partidas (`409 probe_test_required`).
4. **El test se puntúa en el servidor:**
   - Las preguntas y su asignación a sondas son reglas compartidas; los textos van en el copy.
   - El cliente decide si hace falta el desempate con la misma función.
   - El servidor recalcula, y si hay empate y no viene el desempate, responde `400 tiebreak_required`.
5. **La sonda revelada se elige sola** en el Hangar. Las demás desbloqueadas se eligen en el selector.
6. **Calibración:** con la sonda propia y una build típica, cada inicial llega de media a la capa 2–4 en 5–20 minutos, y las tres quedan a menos del 25 % entre sí en tiempo medio. Así ninguna inicial es mejor.

## Global Constraints

Las de M3b-1 (rama `feature/galaxy-m3b2` desde `develop`, TDD, determinismo, contenido como datos, frontend con ui-ux-pro-max y DESIGN_SYSTEM, copy, CSP, BD local solo con `migration up` y `test db`, migración con fecha UTC).

### Valores de partida

**Sondas.** «Fuerte» es su estadística destacada; la peculiaridad es un `quirk` de código con sus números como datos.

| id | Nombre | Vida | Vel. | Recogida | Blindaje | Regen | Arma | Bonus | Peculiaridad | Se consigue |
|---|---|---|---|---|---|---|---|---|---|---|
| `lumen` | Lumen | 100 | 90 | 40 | 0 | 0 | `pulse` | recogida +.3, exp. +.1 | `magnet`: cada 30 s atrae todos los fragmentos de la pantalla | inicial |
| `bastion` | Bastión | 140 | 76 | 32 | .12 | .2 | `nova` | vida máx. +.1 | `thorns`: devuelve el 60 % del daño de contacto | inicial |
| `spark` | Chispa | 80 | 104 | 36 | 0 | 0 | `arc` | enfriamiento +.08, crítico +.05 | `dash`: al recibir un golpe, esquiva con un salto de 60 u y medio segundo invulnerable (cada 8 s) | inicial |
| `sentinel` | Vigía | 95 | 86 | 36 | .04 | 0 | `drone` | — | `overwatch`: un dron más con cualquier arma de drones | 3 Núcleos vencidos |
| `anchor` | Áncora | 120 | 80 | 36 | .08 | 0 | `field` | área +.15 | `second-wind`: una vez por partida, al caer vuelve con el 30 % de la vida | llegar a la capa 4 |
| `prism` | Prisma | 90 | 90 | 36 | 0 | 0 | `beam` | potencia elemental +.25 | `prism-touch`: el 20 % de sus golpes de arma aplica un elemento que rota (quemadura, ralentización, corrosión, descarga) | 5 extracciones |
| `comet` | Cometa | 85 | 112 | 40 | 0 | 0 | `boomerang` | velocidad +.1 | `afterburner`: tras cada baja, +20 % de velocidad durante 2 s | 2 000 bajas |
| `echo` | Eco | 100 | 84 | 36 | .05 | 0 | `turret` | duración +.2 | `salvage`: cada 30 bajas suelta un kit de reparación | 15 incursiones terminadas |

Las dos iniciales que no te asigna el test se consiguen con 3 incursiones terminadas cada una.

**Test** (reglas en `shared`, textos en el copy). Cada respuesta suma un punto a su sonda: A Lumen, B Bastión, C Chispa.
1. «Suena una alarma en la estación. ¿Qué haces primero?»
   - A: «Miro los sensores para entender qué pasa».
   - B: «Me pongo delante de la puerta».
   - C: «Corro hacia el ruido».
2. «Te ofrecen tres misiones. ¿Cuál eliges?»
   - A: «Cartografiar un sector desconocido».
   - B: «Escoltar un convoy hasta casa».
   - C: «Una entrega contrarreloj».
3. «¿Qué llevas siempre encima?»
   - A: «Un cuaderno lleno de notas».
   - B: «Herramientas para arreglarlo todo».
   - C: «Lo mínimo, para ir ligero».
4. «PERKINS se equivoca de rumbo. ¿Qué haces?»
   - A: «Le enseño los datos».
   - B: «Aguanto, ya llegaremos».
   - C: «Cojo los mandos».
5. «Un enjambre de la Estática se acerca».
   - A: «Busco un hueco entre ellos».
   - B: «Planto los pies y resisto».
   - C: «Me lanzo antes de que se junten».
6. Desempate, solo si dos o tres sondas empatan: «Última pregunta: ¿qué es lo mejor de una incursión?»
   - A: «Descubrir».
   - B: «Volver entero».
   - C: «La velocidad».

   Si sigue habiendo empate (empate a tres), gana la sonda de la respuesta de desempate.

**Perfiles:**
- **Lumen:** «Eres de los que miran el mapa entero antes de dar un paso. Lumen ve lejos y aprende rápido».
- **Bastión:** «Eres de los que aguantan cuando todo tiembla. Bastión no se mueve y nada lo tumba».
- **Chispa:** «Eres de los que llegan antes de que empiece. Chispa es rápida, frágil y nunca está donde la buscan».

## Review Focus

1. **Doble envío del test o envío tras tenerlo hecho:** el resultado es el primero y nunca cambia, con la misma respuesta, sin 500 → Tarea 4.
2. **Una sonda bloqueada, inexistente o de otra versión del contenido**, elegida o enviada al empezar una partida: 400/409 claros, nunca una partida con una sonda que no te toca → Tarea 4.
3. **Desbloqueos con partidas sospechosas o sin terminar:** no cuentan → Tarea 3.
4. **Recargar a mitad del test o volver atrás:** el test no queda medio guardado ni deja la cuenta sin sonda; se repite desde el principio hasta enviarse → Tarea 6.
5. **Peculiaridades en el límite:** `second-wind` una sola vez aunque caigas dos veces, `dash` sin atravesar la invulnerabilidad para siempre, `salvage` y `magnet` deterministas en la repetición → Tarea 1.

---

### Task 1: Sondas y peculiaridades en la simulación

**Files:**
- Create: `packages/sim/src/systems/quirks.ts`.
- Modify: `content/{types,schema,default}.ts`, `systems/{probes,combat,stats}.ts`, `sim.ts`.
- Test: `packages/sim/test/quirks.test.ts`.

**Interfaces:**
- **Produces:**
  - `ProbeDef.quirk: Quirk | null`, la unión de:
    - `{ kind:'magnet'; every }`
    - `{ kind:'thorns'; share }`
    - `{ kind:'dash'; every; distance; invuln }`
    - `{ kind:'overwatch'; drones }`
    - `{ kind:'second-wind'; hp }`
    - `{ kind:'prism-touch'; chance; cycle }`
    - `{ kind:'afterburner'; bonus; seconds }`
    - `{ kind:'salvage'; kills }`
  - las 8 sondas en `DEFAULT_CONTENT`;
  - eventos `{ t:'quirk'; probe; kind }` para el escenario.
- [ ] **Step 1: Tests que fallan.**
  - Una prueba por peculiaridad, con su número.
  - `second-wind` una sola vez.
  - `dash` respeta su enfriamiento.
  - Una partida de bot con cada sonda se repite con el mismo hash.
  - El esquema rechaza una peculiaridad desconocida.
- [ ] **Step 2–4:** ver fallar, implementar, ver pasar.
- [ ] **Step 5: Commit** `feat(galaxy): las 8 sondas y sus peculiaridades`.

### Task 2: Calibración de las iniciales

**Files:** `packages/sim/test/calibration.test.ts`, `content/default.ts`.
- [ ] Larga (`GALAXY_CALIBRATE=1`): cada inicial con una build típica llega a la capa 2–4 en 5–20 min de media en 5 semillas, y las tres quedan a menos del 25 % entre sí. Corta (CI): las tres aguantan 3 minutos de la capa 1. Ajustes como *rulings*.
- [ ] **Commit** `test(galaxy): las tres sondas iniciales equilibradas`.

### Task 3: Reglas del test y de los desbloqueos

**Files:**
- Create: `packages/shared/src/probes/{test,unlocks}.ts`.
- Modify: `config/registry.ts` (clave `probes`), `api/runs.ts` (`ProbeCard` gana `unlocked`, `condition` y `progress`), `errors.ts`.
- Test: `packages/shared/test/probes-*.test.ts`.

**Interfaces:**
- **Produces:**
  - `PROBE_TEST: { questions: { answers: [string, string, string] }[]; tiebreak: { answers: [...] } }` (ids de sonda por respuesta);
  - `scoreTest(answers: number[]): { probe: string } | { tie: string[] }`;
  - `unlockedProbes(stats: RunStats, cfg, assigned: string): string[]`;
  - `probeProgress(stats, cfg)`;
  - `RunStats { runs; bossKills; maxDepth; extractions; kills }`.
- [ ] **Step 1: Tests que fallan.**
  - Puntuación de cada perfil.
  - Empates a dos y a tres resueltos por el desempate.
  - Respuestas fuera de rango rechazadas.
  - fast-check: siempre sale una de las tres iniciales con 5 + 1 respuestas.
  - Los desbloqueos llegan a su umbral y no antes.
  - La asignada siempre está desbloqueada.
- [ ] **Step 2–5.** **Commit** `feat(galaxy): reglas del test de la sonda y de los desbloqueos`.

### Task 4: Base de datos y servidor

**Files:**
- Create: migración `<UTC>_galaxy_probes.sql` (`galaxy.probe_tests`: cuenta, respuestas, sonda, fecha; solo se añade; un test por cuenta) y `supabase/tests/974_galaxy_probes.test.sql`.
- Modify: `apps/server/src/runs/{hangar,service,routes}.ts`.
- Test: `apps/server/test/integration/probes.test.ts`.
- [ ] **Step 1: Tests que fallan.**
  - pgTAP: un test por cuenta, sin `update` ni `delete`, respuestas válidas.
  - Integración:
    - el test asigna y guarda la sonda, y la elige en el Hangar;
    - un segundo envío devuelve el mismo resultado;
    - un empate sin desempate da `400 tiebreak_required`;
    - el Hangar enseña las 8 sondas con su estado y progreso;
    - elegir una bloqueada da 409 y elegir una desbloqueada vale;
    - empezar sin test da `409 probe_test_required`;
    - las partidas sospechosas no desbloquean.
- [ ] **Step 2–5.** **Commit** `feat(galaxy): test de la sonda y desbloqueos en el servidor`.

### Task 5: Sprites de las 7 sondas nuevas

- [ ] Rejillas de 16×16 con 2 fotogramas, cada una con su silueta y su tono (Bastión acero y Solar, Chispa violeta y cian, Vigía verde con antena, Áncora gris pesada, Prisma cristal irisado, Cometa blanca con estela, Eco cobre con torreta).
- [ ] La prueba de sprites exige las 8. Revisar la hoja en una captura.
- [ ] **Commit**.

### Task 6: La pantalla del test

**Files:**
- Create: `apps/web/src/probe-test/{ProbeTest,Reveal}.tsx`, ruta `/sonda`.
- Modify: `CrearCuenta.tsx` (al terminar, a `/sonda`), `HangarScreen.tsx` (sin test, al test), copy y CSS.
- [ ] **Step 1: Tests que fallan.**
  - Una pregunta cada vez, con progreso y 3 cartas (1–3 y flechas, Enter).
  - El desempate solo si hace falta.
  - El envío y el revelado con perfil.
  - Recargar a mitad empieza de nuevo y no guarda nada.
  - Un error de red permite reintentar.
  - Movimiento reducido.
- [ ] Antes del CSS, ui-ux-pro-max y DESIGN_SYSTEM §8 sexies («Test de la sonda»).
- [ ] **Commit**.

### Task 7: Selector de sondas en el Hangar

- [ ] El panel Sonda pasa a ser un carrusel o rejilla de 8:
  - las desbloqueadas se eligen;
  - las bloqueadas dicen su condición con una barra de progreso;
  - la elegida, destacada.
- [ ] Pruebas de web y capturas a 1280 y 1920.
- [ ] **Commit**.

### Task 8: e2e, documentación, verificación, revisión final, PR y PRE

- [ ] El e2e de la incursión hace el test después de crear la cuenta.
- [ ] DESIGN_SYSTEM y DEPLOY_PRE (paso 7).
- [ ] Verificación completa, revisor nuevo, una pasada de correcciones, PR, CI, fusión, PRE y registro.
