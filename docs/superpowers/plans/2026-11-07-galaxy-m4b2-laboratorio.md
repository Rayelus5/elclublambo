# Galaxy M4b-2 · Laboratorio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El Laboratorio de la estación se repara y abre un árbol de mejoras permanentes con cuatro ramas (sonda, reliquias, estación y extracción), de nodos pequeños con niveles, pagados con polvo estelar y componentes, cuyos efectos llegan a las incursiones, la refinería, la antena y la colección.

**Architecture:** El árbol es configuración viva (`lab`): nodos con rama, efecto, cuánto da por nivel, niveles máximos, requisito y coste creciente. Una regla pura, `labEffects(levels, cfg)`, reúne lo comprado en bonos de estadísticas (que se suman a los del nivel de la sonda en la foto de cada incursión) y multiplicadores de cobro, refinería, antena, desintegración y fusión. El servidor guarda los niveles por cuenta, cobra cada mejora en una operación idempotente bajo el candado de la estación y asienta la refinería antes de cambiar su ritmo. La web enseña el árbol en `/laboratorio`, con iconos pintados en Aseprite.

**Tech Stack:** pnpm workspace `games/galaxy` (`@galaxy/sim`, `@galaxy/shared` con Zod, `@galaxy/server` con Fastify + Kysely + Postgres, `@galaxy/web` con React 19 y TanStack Query 5), migraciones y pgTAP en `supabase/` de la raíz, Playwright, Aseprite 1.3 por CLI con Lua.

**Spec:** `games/galaxy/docs/GDD.md` §10.6 («Un árbol de mejoras enorme, con ramas de sonda, reliquias, estación y extracción. Tiene muchos nodos pequeños con rendimiento decreciente. Se paga con polvo estelar y componentes, y nunca rompe el equilibrio»), §6 («Laboratorio: da mejoras permanentes comunes a todas las sondas. Freno: respetan los topes de §8.6»), §8.6, §10.2, §11; diseño en `games/galaxy/docs/DESIGN_SYSTEM.md` (§8 octies, nuevo).

## Global Constraints

- TDD estricto: cada paso de código tiene antes su prueba que falla (Vitest, pgTAP, Playwright).
- La simulación no cambia de reglas: los bonos del Laboratorio entran por `bonuses`, la fuente de M4b-1, y pasan por el rendimiento decreciente y los topes de §8.6. El campo de pruebas, con sondas de nivel 10 y el Laboratorio al máximo, sigue bajo sus techos.
- Nada de dinero fuera de `credit`/`debit` en la misma transacción. Las acciones que cobran van en `runOperation` con clave de idempotencia, nombran el nivel que compran (`409` con vista vieja) y ningún saldo baja de 0.
- Copy en español, tú, títulos directos sin símbolos especiales (·, :, —, →) y sin punto final. Cada código de error nuevo tiene su texto en `copy/es.ts`.
- Antes de CSS nuevo se consulta ui-ux-pro-max y se actualiza `DESIGN_SYSTEM.md`. Se respeta `prefers-reduced-motion` y el foco es visible.
- El arte de muestra se pinta en Aseprite (Lua por CLI). Las fuentes `.aseprite` van en `games/galaxy/art/`; `art/` no entra en la imagen Docker.
- La BD local es del usuario: `pnpm exec supabase migration up` y `pnpm exec supabase test db`, nunca `db reset`. Solo se escriben cuentas `e2e_*` o de prueba.
- Commits en español, convencionales, con las líneas de coautoría de la sesión.

## Review Focus

1. **Mejoras a la vez, repetidas o con vista vieja:** una clave repetida devuelve lo mismo, dos claves distintas no compran dos niveles por uno, y una vista vieja da `409 lab_changed` sin cobrar → Tarea 3.
2. **Un nodo con su requisito sin comprar, uno al máximo, o el Laboratorio sin reparar:** `409` claro (`lab_locked`, `lab_maxed`, `lab_closed`) y nada cobrado → Tarea 3.
3. **La refinería al cambiar su ritmo o su cola:** lo refinado al ritmo viejo se conserva, y una cola más grande no se encoge al bajar la configuración → Tareas 1 y 3.
4. **Los multiplicadores de cobro con los topes:** el bonus de monedas, polvo y material se aplica antes de los topes por partida y nunca los pasa. Una partida sospechosa cobra como antes, con su parte → Tarea 4.
5. **El Laboratorio al máximo con las builds extremas:** el campo de pruebas con sonda de nivel 10 y todas las estadísticas del Laboratorio sigue bajo los techos → Tarea 1.

---

## File Structure

- `games/galaxy/packages/shared/src/lab/tree.ts` (nuevo): el árbol por defecto, `labNodeStatus`, `labEffects`.
- `games/galaxy/packages/shared/src/config/registry.ts`: la clave `lab` y `station.lab`.
- `games/galaxy/packages/shared/src/station/rooms.ts`, `refinery.ts`, `antenna.ts`: el Laboratorio reparable y los `boost`.
- `games/galaxy/packages/shared/src/api/lab.ts` (nuevo), `errors.ts`, `index.ts`.
- `supabase/migrations/<ts>_galaxy_lab.sql`, `supabase/tests/978_galaxy_lab.test.sql`.
- `games/galaxy/apps/server/src/lab/service.ts` y `routes.ts` (nuevos), `station/service.ts`, `runs/service.ts`, `collection/service.ts`, `db/schema.ts`, `app.ts`.
- `games/galaxy/apps/web/src/api/lab.ts`, `lab/LabScreen.tsx` (nuevos), `station/StationScreen.tsx`, `App.tsx`, `copy/es.ts`, `styles/app.css`.
- `games/galaxy/art/lab/paint-lab.lua` (nuevo) y sus `.aseprite`; iconos en `games/galaxy/apps/web/src/lab/icons/`.
- `games/galaxy/apps/web/e2e/lab.spec.ts` (nuevo); `games/galaxy/docs/DEPLOY_PRE.md` paso 11.

---

### Task 1: Reglas del árbol, configuración y API

**Files:**
- Create: `games/galaxy/packages/shared/src/lab/tree.ts`, `packages/shared/src/api/lab.ts`
- Modify: `packages/shared/src/config/registry.ts`, `station/rooms.ts`, `station/refinery.ts`, `station/antenna.ts`, `errors.ts`, `index.ts`, `apps/web/src/copy/es.ts` (los errores)
- Test: `games/galaxy/packages/shared/test/lab.test.ts` (nuevo), `test/station.test.ts`, `packages/sim/test/builds.test.ts`

**Interfaces:**
- Produces:
  - **Configuración `lab`:**
    ```ts
    {
      nodes: {
        id; branch: 'probe' | 'relics' | 'station' | 'extraction'; name: string;
        effect:
          | { kind: 'stat'; stat: StatKey }
          | { kind: 'payout'; currency: 'coins' | 'dust' | 'material' }
          | { kind: 'refinery'; field: 'rate' | 'queue' }
          | { kind: 'antenna' }
          | { kind: 'disintegrate' }
          | { kind: 'fusion' };
        per: number;          // 0–0,2 por nivel
        max: number;          // 1–10 niveles
        requires: string | null;
        cost: { dust: number; components: number };
        growth: number;       // 1–3; el nivel L cuesta round(cost × growth^(L−1))
      }[]
    }
    ```
    El esquema valida:
    - ids únicos;
    - que `requires` apunta a otro nodo;
    - que no hay ciclos;
    - que `fusion` y `payout` suman como mucho 0,5 entre todos sus niveles.
  - **El árbol por defecto:** 16 nodos con `max: 5` y `growth: 1,6`. Las raíces cuestan 40 de polvo y 15 componentes, los del medio 60/20 y los del fondo 100/40.

    | Rama | Nodo (`id`, nombre) | Efecto por nivel | Requiere |
    |---|---|---|---|
    | probe | `hull` «Blindaje reforzado» | vida +2 % | — |
    | probe | `thrusters` «Propulsores» | velocidad +1 % | `hull` |
    | probe | `targeting` «Puntería» | daño +2 % | `hull` |
    | probe | `reactor` «Reactor» | recarga +1 % | `targeting` |
    | relics | `resonance` «Resonancia» | potencia elemental +3 % | — |
    | relics | `fortune` «Fortuna» | suerte +3 % | `resonance` |
    | relics | `recycling` «Reciclaje» | polvo al desintegrar +4 % | `resonance` |
    | relics | `stable-fusion` «Fusión estable» | polvo de fusión −4 % | `recycling` |
    | station | `throughput` «Caudal» | ritmo de la refinería +5 % | — |
    | station | `silos` «Silos» | cola de la refinería +10 % | `throughput` |
    | station | `receiver` «Receptor» | ritmo de la antena +5 % | `throughput` |
    | station | `salvage` «Chatarrería» | material de las incursiones +4 % | `silos` |
    | extraction | `magnet` «Imán» | alcance de recogida +4 % | — |
    | extraction | `ledger` «Contabilidad» | monedas de las incursiones +2 % | `magnet` |
    | extraction | `sieve` «Tamiz» | polvo de las incursiones +2 % | `magnet` |
    | extraction | `study` «Estudio» | experiencia +2 % | `ledger` |

  - **`station.lab`:** `{ levels: [{ cost: { components: 50, coins: 500 } }] }`.
    - En `ROOMS`, `lab` pasa a `{ kind: 'machine', initial: 0 }`.
    - `roomStatus` lee sus niveles de `cfg.lab.levels`: roto al empezar y funcionando tras la reparación (nivel máximo 1).
  - **Reglas puras:**
    - `labCost(node, level): { dust; components }` es el coste de llegar a `level`.
    - `labNodeStatus(node, levels: Record<string, number>, cfg): { level; max; unlocked; next: { dust; components } | null }`. `unlocked` es «su requisito tiene nivel ≥ 1, o no tiene requisito».
    - `labEffects(levels, cfg): LabEffects`, con:
      ```ts
      LabEffects = {
        bonuses: StatBonus[];                     // una entrada por estadística, sumada
        payout: { coins: number; dust: number; material: number };
        refinery: { rate: number; queue: number };
        antenna: number;
        disintegrate: number;
        fusion: number;
      }
      ```
      Cada valor es una fracción añadida (0,1 = +10 %).
    - `NO_LAB_EFFECTS`.
  - **Boost en la refinería y la antena:**
    - `refineryLevel(level, cfg, boost = { rate: 0, queue: 0 })` da `rate × (1 + boost.rate)` y `floor(queue × (1 + boost.queue))`;
    - `advanceRefinery(row, level, cfg, now, boost?)`, `nextRefined(row, level, cfg, boost?)`;
    - `antennaRate(level, cfg, boost = 0)`, `antennaAccrued(clock, level, cfg, now, boost?)`.
  - **API:**
    - `LabNodeView = { id, branch, name, effect, per, level, max, unlocked, requires, next }`;
    - `LabView = { open: boolean; nodes: LabNodeView[]; effects: LabEffects; wallet: Wallet }`;
    - `labUpgradeSchema = z.object({ level: z.number().int().min(1).max(10) }).strict()`.
  - **Errores:** `lab_closed`, `lab_locked`, `lab_maxed` y `lab_changed`, con su texto en la web:
    - «Repara el laboratorio en la estación para usarlo»;
    - «Mejora antes el nodo que lo abre»;
    - «Ese nodo ya está al máximo»;
    - «Ese nodo ya había cambiado. Míralo y vuelve a intentarlo».

- [ ] **Step 1: Pruebas que fallan** (`lab.test.ts`):
  - el árbol por defecto tiene 16 nodos, 4 por rama, y cada rama una raíz;
  - `labCost(hull, 1)` es `{ 40, 15 }` y `labCost(hull, 5)` es `{ round(40 × 1,6⁴) = 262, round(15 × 1,6⁴) = 98 }`;
  - `labNodeStatus` dice:
    - `thrusters` cerrado sin `hull`;
    - abierto con `hull` al 1;
    - `next` `null` en el 5.
  - `labEffects` con `{ hull: 2, targeting: 5, ledger: 3, throughput: 4, silos: 1, receiver: 2, recycling: 5, 'stable-fusion': 1 }` da:
    - bonos `maxHp 0,04` y `damage 0,1`;
    - `payout.coins 0,06`;
    - `refinery { rate 0,2, queue 0,1 }`;
    - `antenna 0,1`;
    - `disintegrate 0,2`;
    - `fusion 0,04`.

    Un nodo desconocido en `levels` se ignora y un nivel por encima de `max` se recorta.
  - El esquema rechaza:
    - un `requires` a un nodo que no existe;
    - un ciclo (`a` necesita `b` y `b` necesita `a`);
    - `per` 0,3;
    - una fusión que sumaría más de 0,5.
  - En `station.test.ts`:
    - el Laboratorio empieza roto con su reparación (50 componentes y 500 monedas) y funciona en el nivel 1;
    - `refineryLevel(1, cfg, { rate: 0,5, queue: 0,1 })` es `{ 30, 110 }`;
    - `antennaRate(1, cfg, 0,2)` es `0,15`.
  - En `builds.test.ts`, `VETERAN` suma ahora las estadísticas del Laboratorio al máximo (vida +0,1, velocidad +0,05, daño +0,1, recarga +0,05, potencia elemental +0,15, suerte +0,15, recogida +0,2, experiencia +0,1). El techo sigue en su sitio. Una prueba de `lab.test.ts` fija que esos son los valores de `labEffects` con todo al máximo, más los del nivel 10 de la sonda.
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project unit packages/shared packages/sim/test/builds.test.ts`. Esperado: FALLAN.
- [ ] **Step 3:** Implementar. El texto de los errores va en `copy/es.ts`. Las vistas existentes de la estación siguen igual: el `boost` es opcional.
- [ ] **Step 4:** La misma orden más typecheck. Esperado: PASAN, y el campo de pruebas bajo sus techos. Si un techo se pasa, se bajan los `per` del árbol, no el techo.
- [ ] **Step 5: Commit** `feat(galaxy): reglas y árbol del laboratorio`.

### Task 2: La tabla del Laboratorio

**Files:**
- Create: `supabase/migrations/<timestamp UTC>_galaxy_lab.sql`, `supabase/tests/978_galaxy_lab.test.sql`
- Modify: `games/galaxy/apps/server/src/db/schema.ts`

**Interfaces:**
- Produces: `galaxy.lab_nodes`:
  - columnas:
    - `account_id uuid`, que referencia a `galaxy.accounts` con `on delete cascade`;
    - `node text`, con `check (node ~ '^[a-z0-9-]{1,32}$')`;
    - `level smallint not null check (level between 1 and 10)`;
    - `updated_at timestamptz not null default now()`;
    - primary key `(account_id, node)`;
  - RLS activado y una política para `galaxy_api`;
  - `select, insert, update` para `galaxy_api`;
  - revocado a `public`, `anon`, `authenticated` y `service_role`.

- [ ] **Step 1:** pgTAP que falla:
  - la tabla y su clave primaria existen;
  - RLS activado;
  - `level` 0 y 11 se rechazan;
  - `galaxy_api` no puede borrar, y `anon` y `service_role` no pueden leer.
- [ ] **Step 2:** `pnpm exec supabase test db`. Esperado: el archivo 978 FALLA.
- [ ] **Step 3:** Escribir la migración, aplicarla con `pnpm exec supabase migration up` y añadir `LabNodesTable` en `db/schema.ts`.
- [ ] **Step 4:** `pnpm exec supabase test db`. Esperado: PASA todo.
- [ ] **Step 5: Commit** `feat(galaxy): tabla del laboratorio`.

### Task 3: El servidor del Laboratorio y sus efectos en la estación

**Files:**
- Create: `games/galaxy/apps/server/src/lab/service.ts`, `lab/routes.ts`
- Modify: `apps/server/src/station/service.ts`, `app.ts`
- Test: `games/galaxy/apps/server/test/integration/lab.test.ts` (nuevo), `test/integration/station.test.ts`

**Interfaces:**
- Consumes: Tareas 1 y 2.
- Produces:
  - `labLevels(db, accountId): Promise<Record<string, number>>`
  - `accountLabEffects(db, accountId, cfg): Promise<LabEffects>`
  - `labView(deps, accountId, db?): Promise<LabView>`
  - `upgradeLabNode(deps, trx, accountId, node, level, key): Promise<LabView>`, en este orden:
    1. el candado `station:<cuenta>`;
    2. 400 si el nodo no existe;
    3. `lab_closed` si la sala `lab` está en el nivel 0;
    4. `lab_locked` si el requisito no está comprado;
    5. `lab_maxed`;
    6. `lab_changed` si `level !== actual + 1`;
    7. si el nodo es de la rama de la estación, asentar antes la refinería al ritmo actual (avanzarla y guardarla con el `boost` de antes);
    8. cobrar con `debit` polvo y componentes, motivo `'lab'`, referencia `{ node, level }`;
    9. upsert de la fila.
  - Rutas:
    - `GET /galaxy/api/lab`;
    - `POST /galaxy/api/lab/nodes/:id/upgrade` con `{ level }`: sesión primero, clave de idempotencia, `runOperation`, límite `lab` 60/60.
  - La vista y las acciones de la estación usan `labEffects(...).refinery` y `.antenna` en todas las llamadas a `refineryLevel`, `advanceRefinery`, `nextRefined`, `antennaRate` y `antennaAccrued`.

- [ ] **Step 1: Pruebas que fallan** (`lab.test.ts`, con `give` como en `station.test.ts`):
  - `'cerrado hasta reparar la sala: GET open false y mejorar da lab_closed'`;
  - `'reparar el laboratorio (50 componentes y 500 monedas) lo abre y Blindaje reforzado al 1 cuesta 40 de polvo y 15 componentes'`;
  - `'un nodo con su requisito sin comprar da lab_locked'`;
  - `'una vista vieja da lab_changed sin cobrar'`;
  - `'una clave repetida cobra una vez'`;
  - `'dos mejoras a la vez con claves distintas al mismo nivel: una pasa'`;
  - `'al máximo, lab_maxed'`;
  - `'Caudal sube el ritmo de la refinería y lo refinado antes se queda'`: cargar 100 de material, esperar 1 h (refina 20) y comprar Caudal 1, que asienta. Esperar 1 h más da 21 (`floor(20 × 1,05)`) y `ready` es 41;
  - `'Receptor sube el ritmo de la antena en la vista'`;
  - `'sin sesión, 401 antes que validar el cuerpo'`.
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project integration apps/server/test/integration/lab.test.ts`. Esperado: FALLAN.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** La integración entera. Esperado: PASAN.
- [ ] **Step 5: Commit** `feat(galaxy): el laboratorio en el servidor`.

### Task 4: Los efectos del Laboratorio en las incursiones y la colección

**Files:**
- Modify: `games/galaxy/packages/shared/src/runs/rewards.ts`, `apps/server/src/runs/service.ts`, `apps/server/src/collection/service.ts`
- Test: `packages/shared/test/runs-rewards.test.ts`, `apps/server/test/integration/runs.test.ts`, `test/integration/collection.test.ts`

**Interfaces:**
- Consumes: `accountLabEffects` (Tarea 3).
- Produces:
  - `runPayout(claim, cfg, factor, penalized, boost = { coins: 0, dust: 0 })` y `runMaterial(claim, cfg, factor, penalized, boost = 0)` multiplican por `1 + boost` antes de los topes.
  - `startRun` guarda `{ bonuses, variant, payout }`. En `bonuses` van los del nivel de la sonda seguidos de los del Laboratorio, y en `payout` los multiplicadores. `RunStart.bonuses` lleva ambos.
  - `finishRun` lee `payout` de `runs.upgrades` (0 si falta).
  - En la colección, la vista de detalle y `disintegrate` dan `floor(yield × (1 + disintegrate))`, y el `dust` de cada receta de fusión (lista y `fuse`) es `ceil(dust × (1 − fusion))`.

- [ ] **Step 1: Pruebas que fallan:**
  - `runPayout` con `boost { coins: 0,1 }` paga `floor(coins × k × 1,1)` y nunca pasa `caps.runCoins`. Una partida sospechosa sigue con su parte;
  - `runMaterial` con `boost` 0,2 paga más y respeta `caps.runMaterial`;
  - en la integración de las incursiones, una cuenta con Contabilidad al 3 empieza una partida con `upgrades.payout.coins` 0,06 y sus bonos incluyen los del Laboratorio. Al terminarla cobra un 6 % más que la misma partida sin Laboratorio;
  - en la integración de la colección, con Reciclaje al 5 desintegrar paga un 20 % más de polvo, el detalle lo dice, y con Fusión estable al 1 el polvo de la receta baja un 4 %.
- [ ] **Step 2:** Las pruebas de `runs-rewards`, `runs` y `collection`. Esperado: FALLAN.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Unit e integración enteras. Esperado: PASAN.
- [ ] **Step 5: Commit** `feat(galaxy): el laboratorio mejora las incursiones y la colección`.

### Task 5: La pantalla del Laboratorio y su sala en la estación

**Files:**
- Create: `games/galaxy/apps/web/src/api/lab.ts`, `apps/web/src/lab/LabScreen.tsx`
- Modify:
  - `apps/web/src/App.tsx`: la ruta `/laboratorio`, como `SignedIn`;
  - `station/StationScreen.tsx`: el Laboratorio reparado enlaza a `/laboratorio` y el roto abre un panel con «Reparar»;
  - `copy/es.ts`, `styles/app.css`;
  - `docs/DESIGN_SYSTEM.md`: §8 octies, y una columna en las tarjetas del arma inicial cuando el panel es estrecho, como pulido de M4b-1.
- Test: `games/galaxy/apps/web/test/lab.test.tsx` (nuevo), `test/station.test.tsx`, capturas en `test/browser/lab.browser.test.ts`

**Interfaces:**
- Consumes:
  - `LabView` y la ruta de la Tarea 3;
  - `useUpgradeRoom` de la estación.
- Produces: `useLab()` y `useUpgradeLabNode()`. Esta última hace `mutate({ node, level })` con la intención `lab:<node>:<level>`. En éxito hace `setQueryData` e invalida la cartera; en error invalida la vista y la cartera.

- [ ] **Step 1: Pruebas que fallan:**
  - la estación con el Laboratorio roto abre un panel con «Reparar» y su coste. Arreglado, es un enlace a `/laboratorio`;
  - el Laboratorio cerrado (`open: false`) dice «Repara el laboratorio en la estación para usarlo» con un enlace a la estación;
  - abierto, enseña cuatro ramas (listas con su nombre) y 16 nodos. Cada nodo lleva:
    - nombre;
    - qué da por nivel («+2 % de vida por nivel»);
    - lo que da ahora;
    - sus pips;
    - «Mejorar a nivel 2» con su coste en polvo y componentes.
  - un nodo cerrado dice «Necesita Blindaje reforzado» y no se puede mejorar;
  - sin fondos, el botón está desactivado y dice cuánto falta;
  - mejorar envía `{ level }` con su clave y enseña la vista nueva. Un `409` dice su texto y refresca.
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project web apps/web/test/lab.test.tsx apps/web/test/station.test.tsx`. Esperado: FALLAN.
- [ ] **Step 3: Implementar.** Antes, consultar ui-ux-pro-max: árbol de dependencias, estados cerrado y máximo, foco.
  - **Estética:** un plano de laboratorio, con cuatro columnas en vidrio oscuro con la retícula de un plano y conectores Terminal entre un nodo y el que lo abre.
  - **Nodos:** su icono de Aseprite (Tarea 6; hasta entonces, un icono de la interfaz).
  - **Fondos:** el saldo de polvo y componentes en la cabecera.
- [ ] **Step 4:** La suite web, el typecheck y el lint. Capturas del Laboratorio a 1280, 1600 y 1920 con unos nodos comprados, revisadas. Esperado: PASAN.
- [ ] **Step 5: Commit** `feat(galaxy): la pantalla del laboratorio`.

### Task 6: Los iconos del Laboratorio en Aseprite

**Files:**
- Create: `games/galaxy/art/lab/paint-lab.lua`, sus `.aseprite`, las tiras en `games/galaxy/apps/web/src/lab/icons/<id>.png` y `apps/web/src/lab/icons.ts`
- Modify: `lab/LabScreen.tsx`, `styles/app.css`, `docs/DESIGN_SYSTEM.md`
- Test: `games/galaxy/apps/web/test/lab-art.test.ts` (nuevo)

**Interfaces:**
- Produces: `labIconUrl(id): string | undefined` y `LAB_ICON_FRAMES = 2`. Usa `import.meta.glob(..., { query: '?no-inline' })`.

- [ ] **Step 1: Prueba que falla:**
  - cada uno de los 16 nodos tiene su tira de dos fotogramas de 24×24 (48×24, leído de la cabecera PNG);
  - no sobra ninguna.
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project web apps/web/test/lab-art.test.ts`. Esperado: FALLA.
- [ ] **Step 3: Pintar en Aseprite.** Cada icono enseña su efecto:
  - una placa de blindaje;
  - un propulsor con su llama;
  - una mira;
  - un núcleo de reactor;
  - un cristal elemental;
  - un trébol estelar;
  - una galaxia que se deshace en polvo;
  - dos galaxias fundiéndose;
  - un engranaje con su flujo;
  - un silo;
  - una antena con sus ondas;
  - un imán de chatarra;
  - un imán con fragmentos;
  - una moneda con su libro;
  - un tamiz con polvo;
  - un libro de estudio.

  Cada uno se pinta con la rampa de su rama (Sonda hielo, Reliquias ultravioleta, Estación Solar y Extracción Terminal), con dos fotogramas de brillo. Se revisa una hoja de contacto a ×4. Las tarjetas los reproducen a ×2 con `steps(2)`, y quietos con movimiento reducido.
- [ ] **Step 4:** La suite web y las capturas revisadas. Esperado: PASAN.
- [ ] **Step 5: Commit** `feat(galaxy): los iconos del laboratorio pintados en Aseprite`.

### Task 7: e2e, documentación, verificación, revisión final, PR y PRE

- [ ] **e2e** (`lab.spec.ts`): una cuenta nueva con `grant` de componentes, monedas y polvo:
  - repara el Laboratorio desde la estación;
  - entra en él y compra Blindaje reforzado al 1;
  - ve Propulsores abierto;
  - empieza una incursión cuyos `bonuses` incluyen la vida del Laboratorio;
  - no hay violaciones de CSP.
- [ ] **DEPLOY_PRE paso 11:**
  - la migración;
  - las claves `lab` y `station.lab`;
  - qué comprobar;
  - el aviso sobre una clave `station` publicada antes (no traería `lab` y el Laboratorio seguiría «En reparación»).
- [ ] **Verificación completa:**
  - typecheck y lint;
  - `pnpm -C games/galaxy test`;
  - `GALAXY_CALIBRATE=1`;
  - pgTAP;
  - `TZ=UTC pnpm test:unit` en la raíz;
  - todo el e2e;
  - build de Docker y smoke.
- [ ] **Cierre:**
  - revisor nuevo (opus) con `review-package` y una pasada de correcciones con TDD;
  - PR a `develop`, CI y fusión;
  - comprobación en PRE con una cuenta `e2e_pre_*`;
  - registro a docs y borrar el espacio de trabajo;
  - memoria e informe.
