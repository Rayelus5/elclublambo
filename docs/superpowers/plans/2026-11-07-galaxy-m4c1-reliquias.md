# Galaxy M4c-1 · Niveles y ranuras de las reliquias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada galaxia sube de nivel (1 a 10) con polvo estelar a coste creciente, y fusionarla o desintegrarla devuelve la mitad del polvo invertido. Las ranuras de reliquia 3 a 6 se abren con hitos de juego y polvo.

**Architecture:**
- **El nivel** ya existe en `galaxy.galaxies.level` y la simulación ya lo aplica: +4 % de magnitud por nivel, con rendimiento decreciente y tope 0,5.
- **Subirlo** pasa a ser una operación idempotente que nombra el nivel que compra, cobra el polvo y lo apunta en `level_dust`. Desintegrar y fusionar devuelven la mitad de ese polvo.
- **Las ranuras** se abren de una en una: la siguiente pide su hito (las mismas estadísticas de partidas que desbloquean sondas) y su polvo.
- **Todo** es configuración viva (`relics`).

**Tech Stack:** pnpm workspace `games/galaxy` (`@galaxy/sim`, `@galaxy/shared` con Zod, `@galaxy/server` con Fastify + Kysely + Postgres, `@galaxy/web` con React 19 y TanStack Query 5), migraciones y pgTAP en `supabase/` de la raíz, Playwright.

**Spec:** `games/galaxy/docs/GDD.md`:
- §8.4: «Empiezas con 2 ranuras y llegas hasta 6 desbloqueándolas. Las ranuras se desbloquean con hitos de progresión y polvo estelar».
- §8.4 bis: nivel 1–10 con polvo, coste creciente, +4 % con rendimiento decreciente, visible en la carta, viaja con la galaxia, y fusionar o desintegrar devuelve el 50 % del polvo invertido.
- §8.6.

Diseño en `DESIGN_SYSTEM.md` §8 ter (Hangar) y la colección.

## Global Constraints

- TDD estricto: cada paso de código tiene antes su prueba que falla.
- La simulación no cambia: el nivel ya es entrada de la reliquia. El campo de pruebas, con las seis ranuras llenas de legendarias de nivel 10, sigue bajo sus techos.
- Nada de dinero fuera de `credit`/`debit` en la misma transacción. Las acciones que cobran van en `runOperation`, nombran lo que compran (`409` con vista vieja) y ningún saldo baja de 0.
- Copy en español, títulos directos sin símbolos especiales ni punto final. Cada error nuevo tiene su texto.
- Antes de CSS nuevo se consulta ui-ux-pro-max y se actualiza `DESIGN_SYSTEM.md`.
- La BD local es del usuario: `migration up` y `test db`, nunca `db reset`.
- Commits en español, convencionales, con las líneas de coautoría.

## Review Focus

1. **Subidas a la vez, repetidas o con vista vieja; una galaxia ajena, desintegrada o en el 10:** `409`/`404` claros y nada cobrado → Tarea 3.
2. **Desintegrar o fusionar una galaxia con niveles:** devuelve exactamente la mitad de su polvo invertido, una vez, también si se repite la clave → Tarea 3.
3. **Abrir una ranura sin el hito, sin polvo, con vista vieja o ya en 6:** `409`/`402` claros y nada cobrado → Tarea 3.
4. **Una galaxia de nivel alto equipada:** la incursión que empieza después la usa con su nivel; la que ya está en curso no cambia (foto al empezar) → Tarea 3.
5. **Seis reliquias legendarias de nivel 10:** bajo los techos del campo de pruebas → Tarea 1.

---

### Task 1: Reglas, configuración y API

**Files:**
- Create: `games/galaxy/packages/shared/src/relics/progress.ts`
- Modify: `packages/shared/src/config/registry.ts` (clave `relics`), `api/economy.ts` (`GalaxyDetail`), `api/runs.ts` (`HangarView`), `errors.ts`, `index.ts`, `apps/web/src/copy/es.ts` (errores)
- Test: `games/galaxy/packages/shared/test/relics-progress.test.ts` (nuevo), `packages/sim/test/builds.test.ts`

**Interfaces:**
- Produces:
  - **Configuración `relics`**, con estos valores por defecto:
    - `levels: number[]`, el polvo de llegar a cada nivel del 2 al 10: `[20, 35, 55, 80, 110, 150, 200, 260, 330]`;
    - `refund: number`: `0,5`;
    - `slots: { condition: { stat: keyof RunStats; value: number }; dust: number }[]`, uno por ranura de la 3 a la 6:
      - ranura 3: `{ runs, 5 }` y 100 de polvo;
      - ranura 4: `{ bossKills, 3 }` y 300;
      - ranura 5: `{ maxDepth, 4 }` y 600;
      - ranura 6: `{ extractions, 10 }` y 1000.
  - **Reglas:**
    - `relicLevelCost(level: number, cfg): number | null` es el polvo de pasar de `level` a `level + 1`, o `null` en el 10;
    - `relicRefund(invested: number, cfg): number` es `floor(invested × refund)`;
    - `nextSlot(slots: number, stats: RunStats, cfg)` devuelve `{ slot; condition; progress; dust; ready } | null`. `slot` es la ranura que se abre, con base 1. `ready` es «el hito está cumplido». Devuelve `null` en 6.
  - **Tipos:**
    - `GalaxyDetail` gana `levelUp: { dust: number } | null` y `refund: number`; su `dust` es lo que paga desintegrarla, devolución incluida;
    - `HangarView` gana `nextSlot`.
  - **Esquemas:**
    - `relicLevelUpSchema = { level: int 2–10 }`;
    - `slotUnlockSchema = { slot: int 3–6 }`.
  - **Errores:** `relic_maxed`, `relic_changed`, `slot_locked`, `slot_changed` y `slot_maxed`.
- [ ] **Step 1: Pruebas que fallan.**
  - **Costes:**
    - `relicLevelCost(1)` es 20, `relicLevelCost(9)` es 330 y `relicLevelCost(10)` es `null`;
    - `relicRefund(155)` es 77.
  - **`nextSlot`:**
    - con 2 ranuras y 3 partidas, `{ slot: 3, ready: false, progress: 0,6, dust: 100 }`;
    - con 5 partidas, `ready: true`;
    - con 6 ranuras, `null`.
  - **El esquema rechaza:** costes negativos, `refund` mayor que 1 y más de 4 ranuras.
  - **El campo de pruebas:** `extremeBuilds` con seis reliquias legendarias de nivel 10 (en vez de dos) sigue bajo sus techos de daño. Si no, se ajusta el contenido de las reliquias o se declara la regla, no el techo.
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project unit packages/shared packages/sim/test/builds.test.ts`. Esperado: FALLAN.
- [ ] **Step 3:** Implementar. La web también tiene el texto de los errores.
- [ ] **Step 4:** La misma orden más typecheck. Esperado: PASAN.
- [ ] **Step 5: Commit** `feat(galaxy): reglas de los niveles y las ranuras de las reliquias`.

### Task 2: El polvo invertido en cada galaxia

**Files:**
- Create: `supabase/migrations/<timestamp UTC>_galaxy_relic_levels.sql`, `supabase/tests/979_galaxy_relic_levels.test.sql`
- Modify: `games/galaxy/apps/server/src/db/schema.ts`

**Interfaces:**
- Produces: `galaxy.galaxies.level_dust integer not null default 0 check (level_dust >= 0)`.
- [ ] **Step 1:** pgTAP que falla:
  - la columna existe y vale 0 por defecto;
  - un valor negativo se rechaza;
  - el nivel sigue entre 1 y 10.
- [ ] **Step 2:** `pnpm exec supabase test db`. Esperado: el archivo 979 FALLA.
- [ ] **Step 3:** Escribir la migración y aplicarla con `pnpm exec supabase migration up`. Añadir `level_dust` en `GalaxiesTable`.
- [ ] **Step 4:** `pnpm exec supabase test db`. Esperado: PASA todo.
- [ ] **Step 5: Commit** `feat(galaxy): el polvo invertido en cada galaxia`.

### Task 3: El servidor sube niveles, devuelve polvo y abre ranuras

**Files:**
- Modify: `games/galaxy/apps/server/src/collection/service.ts`, `collection/routes.ts`, `runs/hangar.ts`, `runs/routes.ts`
- Test: `games/galaxy/apps/server/test/integration/relics.test.ts` (nuevo), `test/integration/collection.test.ts`, `test/integration/hangar.test.ts`

**Interfaces:**
- Consumes: Tareas 1 y 2.
- Produces:
  - **`POST /galaxy/api/galaxies/:id/level-up` con `{ level }`.** Es idempotente y cumple:
    - toma la galaxia `FOR UPDATE`, propia y viva (404 si no);
    - `relic_maxed` en el 10 y `relic_changed` si `level !== actual + 1`;
    - `debit` del polvo con motivo `'relic_level'`, y `level_dust += coste`;
    - devuelve el `GalaxyDetail` nuevo y la cartera.
  - **Desintegrar y fusionar** suman la devolución:
    - desintegrar acredita `yield + refund`;
    - fusionar devuelve la suma de las devoluciones de sus padres en un `credit` de motivo `'relic_refund'`, después de cobrar la receta.
  - **El detalle** da `levelUp`, `refund` y un `dust` con la devolución.
  - **`POST /galaxy/api/hangar/slots/unlock` con `{ slot }`.** Es idempotente, con el candado `hangar:<cuenta>`, y cumple:
    - `slot_maxed` en 6;
    - `slot_changed` si `slot !== relic_slots + 1`;
    - `slot_locked` sin el hito;
    - `debit` del polvo con motivo `'relic_slot'` y `relic_slots + 1`;
    - devuelve el `HangarView` nuevo.
  - **`hangarView`** da `nextSlot`.
- [ ] **Step 1: Pruebas que fallan** (`relics.test.ts`):
  - `'subir una galaxia al nivel 2 cuesta 20 de polvo, lo apunta y el detalle lo dice'`;
  - `'vista vieja, clave repetida y dos a la vez: un nivel y un cobro'`;
  - `'una galaxia ajena o desintegrada, 404; en el 10, relic_maxed'`;
  - `'desintegrar una galaxia de nivel 3 (55 de polvo invertido) devuelve 27 además de su rendimiento, una vez'`;
  - `'fusionar cinco galaxias con niveles devuelve la mitad de su polvo'`;
  - `'la ranura 3: cerrada hasta 5 partidas (slot_locked); después cuesta 100 de polvo, abre la ranura y el Hangar enseña la 4'`;
  - `'vista vieja y ranura 6: slot_changed y slot_maxed'`;
  - `'la incursión usa el nivel nuevo de una reliquia equipada; la que estaba en curso no'`.
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project integration apps/server/test/integration/relics.test.ts`. Esperado: FALLAN.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** La integración entera. Esperado: PASAN.
- [ ] **Step 5: Commit** `feat(galaxy): subir de nivel las reliquias y abrir ranuras`.

### Task 4: La colección y el Hangar

**Files:**
- Modify: `games/galaxy/apps/web/src/api/economy.ts` (o donde vivan los hooks de la colección), `api/runs.ts`, `collection/GalaxyDetailDialog.tsx`, `hangar/HangarScreen.tsx`, `copy/es.ts`, `styles/app.css`, `docs/DESIGN_SYSTEM.md`
- Test: `games/galaxy/apps/web/test/collection.test.tsx`, `test/hangar.test.tsx`, capturas

**Interfaces:**
- Produces:
  - `useLevelUpGalaxy()`, con la intención `galaxy:level:<id>:<level>`;
  - `useUnlockSlot()`, con la intención `hangar:slot:<slot>`.

  Las dos refrescan su vista y la cartera en éxito y en error.
- [ ] **Step 1: Pruebas que fallan:**
  - **Detalle de la colección:**
    - dice «Nivel 3 de 10» y «Subir a nivel 4» con «80 de polvo»;
    - sin polvo, desactivado y «Te falta…»;
    - pulsar envía `{ level: 4 }` con su clave;
    - en el 10, «Nivel máximo»;
    - la confirmación de desintegrar dice el polvo total, devolución incluida.
  - **Hangar:**
    - la primera ranura cerrada enseña su hito («Juega 5 incursiones») con su barra;
    - con el hito, «Abrir ranura» con «100 de polvo», que envía `{ slot: 3 }`;
    - las demás siguen con «Se abre más adelante».
- [ ] **Step 2:** Las pruebas web de colección y Hangar. Esperado: FALLAN.
- [ ] **Step 3:** Implementar. Antes, consultar ui-ux-pro-max: progreso hacia un hito y acción desbloqueable. Escribir en `DESIGN_SYSTEM.md`:
  - el bloque de nivel del detalle;
  - la ranura siguiente del Hangar: borde discontinuo, el hito con su barra, y el botón Solar cuando se cumple.
- [ ] **Step 4:** La suite web, el typecheck y el lint. Capturas del Hangar y del detalle, revisadas. Esperado: PASAN.
- [ ] **Step 5: Commit** `feat(galaxy): subir reliquias de nivel y abrir ranuras desde la colección y el Hangar`.

### Task 5: e2e, documentación, verificación, revisión final, PR y PRE

- [ ] **e2e** (`relics.spec.ts`). Una cuenta nueva:
  - con galaxias del escáner y `grant` de polvo, sube una al nivel 3 desde su detalle;
  - la desintegra y cobra la devolución;
  - con incursiones terminadas metidas por el CLI o el API de pruebas que ya usan otros e2e, o en su defecto con el hito de la ranura 3 ajustado en el propio e2e, abre la ranura 3;
  - no hay violaciones de CSP.

  Si el hito no se puede cumplir en un e2e sin tocar la configuración viva de la BD del usuario, la ranura se prueba solo en integración. Eso queda como regla en el registro.
- [ ] **DEPLOY_PRE paso 12:**
  - la migración;
  - la clave `relics`;
  - qué comprobar.
- [ ] **Verificación completa:**
  - typecheck y lint;
  - `pnpm -C games/galaxy test`;
  - `GALAXY_CALIBRATE=1`;
  - pgTAP;
  - `TZ=UTC pnpm test:unit` en la raíz;
  - todo el e2e;
  - Docker y smoke.
- [ ] **Cierre:**
  - revisor nuevo (opus) y una pasada de correcciones con TDD;
  - PR a `develop`, CI y fusión;
  - comprobación en PRE (si Cloudflare está bloqueado por el fútbol, esperar y reintentar);
  - registro a docs y memoria.
