# Modo depuración para admins: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un menú de depuración para admins en incursiones en solitario. Ofrece:
- velocidad de x0,25 a x8, información, colisiones, niveles, invulnerabilidad, curar, matar, Núcleo ya, capa siguiente y dar mejoras;
- incursiones «de prueba» que no pagan nada;
- «Probar en incursión» un borrador del contenido sin publicarlo.

**Architecture:**
- Funciones puras de la sim (`packages/sim/src/debug.ts`) que el navegador aplica entre pasos, sin grabarlas en el registro.
- El servidor sabe que la incursión es de prueba por una bandera `debug` en `galaxy.runs`: no la paga, no la cuenta y la anota en la auditoría.
- Un panel React lateral en `ArenaScreen`, que nunca se monta en `CoopArena`.

**Tech Stack:** TypeScript, Vitest, React 19, PixiJS 8, Fastify y Kysely, zod.

**Spec:** el plan aprobado por el propietario el 2026-11-15, copiado en «Diseño aprobado» al final de este documento.

## Global Constraints

- **Solo admins:** admin o superadmin con `mfa`. En el cliente, `isAdmin(me) && me.mfa`; en el servidor, `requireAdmin`. Ni en el tutorial (`coached`) ni en grupo (`sim.coop`).
- **Velocidades exactas:** `[0.25, 0.5, 1, 1.5, 2, 4, 8]`.
- **Paso a prueba:** cualquier acción que altera la partida convierte la incursión en «de prueba» tras una confirmación con el texto «Esta incursión pasará a ser de prueba y no dará recompensas». Mirar información o colisiones no la convierte.
- **Una incursión de prueba** no paga nada y no cuenta en ranking, temporada, misiones, desbloqueos, Códice, perfil ni estadísticas del panel. Se anota en `admin_audit_log` como `run.test`.
- **Sim:** las partidas sin depuración juegan igual. Los goldens no se mueven y `SIM_VERSION` sigue en `1.14.0`. Nada de `Math.random`, `Date` ni trigonometría nativa en la sim.
- **CSP sin estilos en línea:** variables CSS, como `--p` en `Hud.tsx`. La página nunca crece de lado.
- **Textos** en `apps/web/src/copy/es.ts`: títulos directos, sin punto final ni símbolos.
- **Nunca en local:** tests de integración, `supabase db reset`, `pnpm db:test`, el e2e de la raíz ni `config.test.ts`.
- **Git:** commits en español con las líneas de atribución. PR a `develop`, nunca a `main`. Sin force-push.

## Review Focus

1. **La sesión de admin caduca a mitad de una incursión de prueba.** El fin no puede quedarse reintentando un 403, y aun así no paga. Lo prueba la Task 2: `finish de un no admin con test=true no paga`.
2. **Una acción mientras las cartas están abiertas.** Los botones de Partida están desactivados y la sim devuelve `'not_running'`. Lo prueban la Task 1 (`not_running mientras se elige`) y la Task 4 (`acciones desactivadas eligiendo`).
3. **x8 en un ordenador lento.** Como mucho `ceil(5*speed)` pasos por fotograma y sin deuda acumulada; el panel enseña la velocidad real. Lo prueba la Task 3: `x8 no arrastra deuda tras un tirón`.
4. **Recargar la página con una incursión de prueba guardada.** El reenvío desde `localStorage` lleva `test: true`, y el servidor la reconoce por la bandera de la fila. Lo prueban la Task 4 (`keep guarda test`) y la Task 2 (`fila marcada sin test en el cuerpo no paga`).
5. **Un borrador sin el sector o la sonda elegidos.** Error claro antes de lanzar, sin romper la pantalla. Lo prueba la Task 5: `borrador sin el sector elegido no lanza`.

---

### Task 1: Funciones de depuración en la sim

**Files:**
- Create: `games/galaxy/packages/sim/src/debug.ts`
- Create: `games/galaxy/packages/sim/test/debug.test.ts`
- Modify:
  - `games/galaxy/packages/sim/src/types.ts` (`Sim.debug?`)
  - `games/galaxy/packages/sim/src/systems/probes.ts` (`hurtProbe`)
  - `games/galaxy/packages/sim/src/systems/director.ts` (exporta `layerCrowd`, `aliveCap` y `spawnRate`)
  - `games/galaxy/packages/sim/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DebugResult = 'ok' | 'not_running' | 'not_waves' | 'slots_full' | 'family_owned' | 'unknown';
  export interface DebugGrant { kind: 'weapon' | 'passive' | 'evolution'; id: string; level: number; replace?: number }
  export function debugLevelUp(sim: Sim, probe: number, n: number): DebugResult;
  export function setGod(sim: Sim, on: boolean): DebugResult;
  export function debugHeal(sim: Sim, probe: number): DebugResult;
  export function debugClear(sim: Sim): DebugResult;
  export function debugSummonCore(sim: Sim): DebugResult;
  export function debugSkipLayer(sim: Sim): DebugResult;
  export function debugGrant(sim: Sim, probe: number, g: DebugGrant): DebugResult;
  export function debugInfo(sim: Sim, probe: number): DebugInfo;
  export function layerCrowd(sim: Sim): number;
  export function aliveCap(sim: Sim): number;
  export function spawnRate(sim: Sim): number;
  ```
- `DebugInfo` contiene:
  ```ts
  { tick, layer, phase, layerSeconds, toCore, alive, fauna, cap, rate,
    teamLevel, levelFactor, scale: Scale, coreFactor,
    boss: { id, hp, maxHp } | null,
    pools: { shots, foeShots, pickups, areas, props },
    god, stats: Stats, hp, maxHp, shield, level }
  ```
- `toCore` está en segundos y vale 0 si la fase no es `waves`.
- Todas lanzan `Error('debug_coop')` si `sim.coop`. `setGod` funciona aunque no esté en `running`.

- [ ] **Step 1:** escribir `test/debug.test.ts` con `quietSim` de `fixtures.ts`:
  - **`debugLevelUp`:**
    - `debugLevelUp(sim,0,3)` → `p.level` +3, `pendingLevels` 3 y eventos `levelUp`;
    - tras un `step` el estado es `'choosing'`;
    - tres picks lo devuelven a `'running'`;
    - `not_running mientras se elige`.
  - **`setGod`:** con `setGod(sim,true)`, `hurtProbe(sim,p,50)` no cambia `hp`, `shield`, `invulnT` ni los eventos; con `false` sí hace daño; `stateHash` es igual sin `debug` y con `{god:false}`.
  - **`debugHeal`:** `hp === stats.maxHp` y `shield === shieldCapacity(p)`.
  - **`debugClear`:** con 5 `dummy` y un Núcleo vivos, quedan 0 enemigos y el Núcleo sigue; `foeShots.count === 0`, `blasts.length === 0`; `kills` sin cambiar y ningún evento `kill`.
  - **`debugSummonCore`:**
    - en `waves`: `phase === 'boss'`, `sim.boss` no es null y `clocks.layerStart` igual;
    - en `boss`: devuelve `'not_waves'`;
    - en el siguiente paso no salta ninguna oleada pendiente (una oleada `at: 200` con `tinyContent` no aparece).
  - **`debugSkipLayer`:** con el Núcleo vivo, `layer` +1, `loot.length` +1, `clocks.layerStart === tick`, `sim.boss === null`, 0 enemigos y `bossKills` igual.
  - **`debugGrant`:**
    - un arma nueva en ranura libre;
    - el nivel se recorta a `levels.length`;
    - con las ranuras llenas → `'slots_full'`; con `replace: 0` sustituye la ranura 0;
    - una variante → `'unknown'`;
    - la base cuando ya tienes su variante → `'family_owned'`;
    - una evolución con la base en propiedad → base evolucionada y evento `evolve`;
    - una evolución sin la base y con ranura libre → base al máximo y evolucionada;
    - una pasiva nueva y una existente sube de nivel;
    - un id inexistente → `'unknown'`.
  - **Grupo:** todas lanzan `debug_coop` con `coop` (`options(..., { coop: ... })` como en `coop.test.ts`).
  - **`debugInfo`:** `cap === aliveCap(sim)`, `teamLevel` y `toCore` (`sector.layerSeconds` menos `layerSeconds`).
  - **Refactor del director:** `aliveCap`/`spawnRate` coinciden con el tope y el ritmo actuales.
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project unit packages/sim/test/debug.test.ts` → FAIL (no existe `../src/debug`).
- [ ] **Step 3: implementar.**
  - **`hurtProbe`:** `if (sim.debug?.god) return;` justo después de la primera guarda.
  - **Director:** extraer `aliveCap(sim)` (la expresión `cap` de `spawnGroup`) y `spawnRate(sim)` (la `rate` de `direct`) con el mismo orden de operaciones, y exportar `layerCrowd`.
  - **`debugGrant`:** compone `applyOffer` con sus propias comprobaciones (base de una variante en propiedad, ranuras). Con `replace` mata las balas persistentes de esa ranura con `persistentFor(...)` y luego sustituye.
  - **Evolución:** coloca la base al nivel máximo y llama a `applyOffer({kind:'evolve', id, level:1})`.
- [ ] **Step 4:** `debug.test.ts`, `director.test.ts`, `golden.test.ts` y `boss.test.ts` → PASS, con los goldens sin regenerar.
- [ ] **Step 5:** `pnpm -C games/galaxy typecheck` → 0 errores. Commit `feat(galaxy): funciones de depuración en la sim para el modo admin`.

### Task 2: Incursión de prueba en shared y en el servidor

**Files:**
- Modify:
  - `games/galaxy/packages/shared/src/api/runs.ts`
  - `games/galaxy/packages/shared/src/runs/plausibility.ts`
  - `games/galaxy/apps/server/src/runs/service.ts`
  - `games/galaxy/apps/server/src/runs/routes.ts`
  - `games/galaxy/apps/server/src/runs/stream-routes.ts`
  - `games/galaxy/apps/server/src/admin/stats.ts`
  - `games/galaxy/apps/server/src/admin/runs.ts`
  - `games/galaxy/apps/web/src/copy/es.ts` (errores y nombres de bandera)
- Test:
  - `games/galaxy/packages/shared/test/` (esquemas)
  - `games/galaxy/apps/server/test/integration/runs.test.ts`, `admin-runs.test.ts` y `admin-stats.test.ts` (solo en CI)

**Interfaces:**
- Produces:
  - **Inicio:** `StartRunRequest.test?: true`.
  - **Fin:** `FinishRunRequest.test?: true`; `RunResult.test?: true`.
  - **Nueva ruta:** `POST /runs/:id/test` → `{ id: string; test: true }` (tipo `TestRunResponse`).
  - **Banderas:** `RunFlag` incluye `'debug'` y `TEST_FLAG = 'debug'`.
  - **Panel:** `AdminRunRow.test?: boolean`.
  - **Error nuevo:** `run_test` (409).

- [ ] **Step 1: tests de esquema.** `test: true` se acepta en el inicio y en el fin, `test: false` se rechaza y sin `test` sigue valiendo.
- [ ] **Step 2: tests de integración.**
  - **Inicio:** `POST /runs {test:true}` sin admin → 403; admin sin mfa → 403; admin con mfa → 200, fila con `flags ⊇ ['debug']`, `suspicious = true` y auditoría `run.test`.
  - **`/test`:** marca, es idempotente y deja una sola auditoría. 404 para la incursión de otro y para una en grupo; 409 si ya terminó.
  - **Fin de una incursión de prueba:**
    - payout a cero y `test: true`;
    - cartera, `run_days` y `account_xp` intactos;
    - sin `run_inputs`;
    - misiones sin progreso.
  - **Casos de la Review Focus:**
    - `finish de un no admin con test=true no paga`;
    - `fila marcada sin test en el cuerpo no paga`.
  - **Panel:**
    - las estadísticas excluyen las incursiones de prueba;
    - la lista de sospechosas las excluye;
    - `markRun` sobre una de prueba → 409 `run_test`.
- [ ] **Step 3: implementar** según el diseño aprobado, sin migración (`flags` es `text[]` libre):
  - `markTestRun` hace `select ... for update`;
  - `finishTestRun` corre antes de `checkRun` y `contentAt`;
  - la ruta del fin se salta `creditRunExtras` si `r.test`;
  - la emisión en directo responde 4404 a las incursiones marcadas.
- [ ] **Step 4:** tests de esquema → PASS. `typecheck` → 0 errores. Las de integración corren en CI.
- [ ] **Step 5:** commit `feat(galaxy): incursiones de prueba que no pagan ni cuentan`.

### Task 3: Velocidad del bucle y colisiones en el escenario

**Files:**
- Modify: `games/galaxy/apps/web/src/arena/loop.ts`, `games/galaxy/apps/web/src/arena/stage/stage.ts`
- Create: `games/galaxy/apps/web/src/arena/stage/hitboxes.ts`
- Test: `games/galaxy/apps/web/test/loop.test.ts`, `games/galaxy/apps/web/test/hitboxes.test.ts`

**Interfaces:**
- **Produces, el bucle:** `Loop.setSpeed(s: number): void` y `Loop.speed: number`.
- **Produces, las colisiones:**
  ```ts
  type HitShape =
    | { kind: 'circle'; x: number; y: number; r: number; tone: HitTone }
    | { kind: 'cone'; x: number; y: number; r: number; angle: number; arc: number; tone: HitTone };
  type HitTone = 'probe' | 'pickup' | 'enemy' | 'boss' | 'shot' | 'foe' | 'area' | 'prop' | 'beacon' | 'blast';
  function hitboxShapes(sim: Sim, alpha: number): HitShape[];
  ```
  Y `Stage.setDebug(flags: { hitboxes: boolean }): void`.

- [ ] **Step 1: tests del bucle.**
  - x2 → 2 pasos en un fotograma de 1/60;
  - x0,25 → 1 paso cada 4 fotogramas;
  - x8 → 8 pasos por fotograma;
  - `x8 no arrastra deuda tras un tirón`: un fotograma de 1 s da como mucho 40 pasos y el siguiente, normal;
  - x1 se comporta igual que hoy.
- [ ] **Step 2: tests de las colisiones.**
  - con un enemigo de radio 6 sale un círculo `enemy` con r = 6;
  - la sonda da `probe` con r = `PROBE_RADIUS` y `pickup` con r = `stats.pickup`;
  - un área en cono da `cone`;
  - el Núcleo da `boss`.
- [ ] **Step 3:** ejecutar `vitest run --project web apps/web/test/loop.test.ts apps/web/test/hitboxes.test.ts` y confirmar que falla.
- [ ] **Step 4: implementar.**
  - **Bucle:** `acc += dt*speed` y como mucho `Math.ceil(MAX_STEPS*speed)` pasos; `setSpeed` pone `acc = 0`.
  - **Escenario:**
    - un `Graphics` añadido el último a `world`, que se redibuja en `render` solo si `hitboxes`;
    - trazos de 1 px sin relleno, con un color por tono;
    - añadir `setDebug` a los mocks de `Stage` en los tests que lo simulan.
- [ ] **Step 5:** tests → PASS; `typecheck` → 0 errores. Commit `feat(galaxy): velocidad del bucle y colisiones dibujadas para depuración`.

### Task 4: Panel de depuración en la incursión

**Files:**
- Create:
  - `games/galaxy/apps/web/src/arena/debug/DebugPanel.tsx`
  - `games/galaxy/apps/web/src/arena/debug/DebugInfo.tsx`
  - `games/galaxy/apps/web/src/arena/debug/grant-options.ts`
  - `games/galaxy/apps/web/src/arena/debug/rates.ts`
- Modify:
  - `games/galaxy/apps/web/src/arena/ArenaScreen.tsx`
  - `games/galaxy/apps/web/src/arena/hud/PauseMenu.tsx`
  - `games/galaxy/apps/web/src/arena/hud/Hud.tsx` (etiqueta «Prueba»)
  - `games/galaxy/apps/web/src/hangar/HangarScreen.tsx`
  - `games/galaxy/apps/web/src/hangar/ResultsScreen.tsx`
  - `games/galaxy/apps/web/src/api/runs.ts` (`useMarkTestRun`)
  - `games/galaxy/apps/web/src/copy/es.ts` (`arena.debug`)
  - `games/galaxy/apps/web/src/styles/app.css`
- Test:
  - `games/galaxy/apps/web/test/arena-debug.test.tsx`
  - `games/galaxy/apps/web/test/debug-rates.test.ts`
  - `games/galaxy/apps/web/test/grant-options.test.ts`
  - `games/galaxy/apps/web/test/hangar.test.tsx`

**Interfaces:**
- **Consumes:** las funciones de la Task 1, `Loop.setSpeed` y `Stage.setDebug` (Task 3), y `POST /runs/:id/test` (Task 2).
- **Produces:**
  - prop `debug?: { test: boolean; draft: boolean; markTest(): Promise<void> }` en `ArenaScreen`;
  - `RunEnd.test?: boolean`;
  - prop `onDebug?: () => void` en `PauseMenu`.

- [ ] **Step 1: tests.**
  - **`grant-options`:**
    - lista armas sin variantes, pasivas y evoluciones con su nivel máximo;
    - la búsqueda ignora mayúsculas y tildes.
  - **`rates`:**
    - DPS de 5 s con eventos `hit` sintéticos;
    - velocidad real = Δtick/60/Δpared.
  - **`arena-debug`:**
    - un no admin no ve el panel con F2 ni el botón en la pausa;
    - un admin abre con F2;
    - «Colisiones» no llama a `markTest`;
    - x2 pide confirmación; al cancelar, la velocidad sigue en x1 y no se llama a `markTest`; al confirmar, se llama a `markTest`, la velocidad pasa a x2 y aparece la etiqueta «Prueba»;
    - `acciones desactivadas eligiendo`;
    - «+1 nivel» abre las cartas.
  - **`hangar`:**
    - `keep guarda test`: el cuerpo guardado y el enviado llevan `test: true`;
    - el panel no existe con `coached`.
- [ ] **Step 2:** ejecutarlos y confirmar que fallan.
- [ ] **Step 3: implementar.**
  - **Cómo se abre:**
    - F2 se mira antes que las teclas configurables y solo con `debug`;
    - el panel es lateral y no modal, y se cierra con F2 o con su botón;
    - mientras está abierto, el diálogo de pausa no se muestra.
  - **Acciones:**
    - la primera que altera la partida pausa y muestra la confirmación; tras `markTest()` aplica la acción y corta la emisión con `streamRef.end()`;
    - si `markTest` falla, avisa y no aplica nada;
    - los eventos de las funciones van a `stage.onEvents` a mano.
  - **Clics y teclas:**
    - los botones pierden el foco al pulsarlos;
    - el panel corta `pointerdown`, porque el dash escucha en el lienzo;
    - por encima de x2 se silencian los efectos.
  - **Información:**
    - se actualiza 4 veces por segundo;
    - FPS, velocidad pedida y real, tiempo, `debugInfo`, DPS;
    - versión de contenido o «borrador», y `SIM_VERSION`.
  - **Resultados:** con `r.test`, «Incursión de prueba: sin recompensas» sustituye al progreso y al botín.
- [ ] **Step 4:** tests → PASS; `typecheck` y `lint` → 0 errores. Capturas del panel a 1280, 1600, 1920 y 2560 px, sin desbordar.
- [ ] **Step 5:** commit `feat(galaxy): menú de depuración para admins en incursiones en solitario`.

### Task 5: Probar en incursión un borrador de contenido

**Files:**
- Create: `games/galaxy/apps/web/src/admin/content-draft.ts`
- Modify:
  - `games/galaxy/apps/web/src/admin/ConfigScreen.tsx`
  - `games/galaxy/apps/web/src/hangar/HangarScreen.tsx`
  - `games/galaxy/apps/web/src/hangar/Lobby.tsx`
  - `games/galaxy/apps/web/src/copy/es.ts`
  - `games/galaxy/docs/CONTENIDO.md`
- Test: `games/galaxy/apps/web/test/content-draft.test.ts`, `games/galaxy/apps/web/test/admin-config.test.tsx`, `games/galaxy/apps/web/test/hangar.test.tsx`

**Interfaces:**
- **Consumes:** el inicio con `test: true` (Task 2) y la prop `debug.draft` (Task 4).
- **Produces:**
  ```ts
  saveContentDraft(d: { baseVersion: number; raw: unknown; content: Content }): void;
  readContentDraft(): { baseVersion: number; raw: unknown; content: Content } | null;
  clearContentDraft(): void;
  ```

- [ ] **Step 1: tests.**
  - **Guardado:** guardar y leer dan lo mismo; un dato inválido devuelve null; si el almacenamiento lanza, devuelve null sin romper.
  - **Botón:** solo en la clave `content` y con el borrador válido; pulsarlo guarda y navega a `/incursion`.
  - **Hangar:**
    - un admin con borrador ve el aviso, y «Descartar» lo borra;
    - `borrador sin el sector elegido no lanza`;
    - el lanzamiento envía `test: true` y la incursión usa el contenido del borrador;
    - un no admin ignora el borrador.
- [ ] **Step 2:** ejecutarlos y confirmar que fallan.
- [ ] **Step 3: implementar.**
  - La sesión de un borrador no abre emisión en directo.
  - Al volver al editor, «Recuperar borrador» avisa si `row.version` es distinta de `baseVersion`.
  - En `CONTENIDO.md`, parte B, se explica que un borrador de contenido se puede probar antes de publicarlo.
- [ ] **Step 4:** tests → PASS; `typecheck` y `lint` → 0 errores.
- [ ] **Step 5:** commit `feat(galaxy): probar en incursión un borrador de contenido sin publicarlo`.

---

## Diseño aprobado (2026-11-15)

Es el plan que aprobó el propietario: `C:\Users\rayel\.claude\plans\happy-crunching-toast.md`. Puntos clave:
- **Enfoque:** el A, acciones entre pasos e incursión marcada de prueba.
- **Quién:** admins con mfa, solo en solitario y sin tutorial.
- **Cómo se abre:** F2 y el botón «Depuración» de la pausa.
- **Confirmación:** se pide una vez.
- **Matar:** sin botín y sin tocar el Núcleo.
- **Dar mejora:** respeta las ranuras, y si están llenas pide cuál sustituir.
- **Sonido:** se silencia por encima de x2.
- **Borradores:** solo de la clave `content`.
- **Sin nota de versión.**

Las cuatro entregas son:
1. la sim;
2. el servidor;
3. el cliente (tasks 3 y 4);
4. el borrador.
