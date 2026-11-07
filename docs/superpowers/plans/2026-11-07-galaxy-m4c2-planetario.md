# Galaxy M4c-2 · Planetario visitable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada jugador expone hasta seis galaxias en el planetario de su estación, que le da un bonus pequeño de experiencia en las incursiones. Cualquier jugador puede visitar el planetario de otro por su nombre o desde los destacados.

**Architecture:**
- **Las piezas expuestas** son una tabla nueva, `galaxy.exhibits`, con una fila por pedestal, como el equipo de reliquias. Una galaxia expuesta no se desintegra ni se fusiona (`409 galaxy_exhibited`), igual que una equipada; puede estar equipada a la vez.
- **El prestigio** suma puntos por rareza y acabado de lo expuesto. Se traduce en un bonus de experiencia (`xp`) con tope del 5 %, que entra en `RunStart.bonuses` junto a los del laboratorio y el nivel de la sonda. La simulación no cambia (la estadística `xp` ya existe) y la foto de cada incursión lo guarda.
- **Las visitas** se leen con `GET` y se apuntan una vez por visitante, dueño y día UTC (`galaxy.planetarium_visits`); las propias no cuentan. No dan premio, para que nadie las fabrique con cuentas falsas.
- **La escena** es una cúpula pintada en Aseprite con su proyector animado y seis pedestales; las cartas van encima en el DOM.
- **Todo** es configuración viva (`planetarium`).

**Tech Stack:** pnpm workspace `games/galaxy` (`@galaxy/shared` con Zod, `@galaxy/server` con Fastify + Kysely + Postgres, `@galaxy/web` con React 19, RR7 y TanStack Query 5), migraciones y pgTAP en `supabase/` de la raíz, Playwright, Aseprite en modo batch.

**Spec:** `games/galaxy/docs/GDD.md`:
- §10.5: «Expones tus mejores galaxias y tus amigos pueden visitar tu estación. Da como mucho un bonus pequeño (de partida: ≤5 % a algo secundario), nunca ingresos importantes».
- §14.2: «Cualquiera puede ver tu perfil y tu colección. Desde ahí se puede visitar tu estación». Los perfiles llegan en M5: aquí se visita por nombre y desde los destacados.
- §8.5: «Exponer: las galaxias se exponen en el planetario de la estación».

Diseño en `DESIGN_SYSTEM.md` (sección nueva §8 decies, Planetario).

## Global Constraints

- TDD estricto: cada paso de código tiene antes su prueba que falla.
- La simulación no cambia (`SIM_VERSION` sigue en 1.5.0). El bonus nunca pasa de `planetarium.cap` (0,05) y va por la fuente de bonos con rendimiento decreciente que ya existe.
- Una visita no enseña nada privado: ni saldo, ni equipo, ni la sonda, ni otras galaxias que las expuestas.
- Copy en español, títulos directos sin símbolos especiales ni punto final. Cada error nuevo tiene su texto.
- Antes de CSS nuevo se consulta ui-ux-pro-max y se actualiza `DESIGN_SYSTEM.md`. Arte de escaparate en Aseprite. Movimiento quieto con `prefers-reduced-motion`.
- La BD local es del usuario: `migration up` y `test db`, nunca `db reset`. Los e2e solo escriben cuentas `e2e_*`.
- Commits en español, convencionales, con las líneas de coautoría.

## Review Focus

1. **Desintegrar o fusionar una galaxia expuesta, también desde la bandeja de fusión:** `409 galaxy_exhibited`, nada cobrado ni borrado → Tarea 3 (integración) y Tarea 4 (la colección la marca «Expuesta» y no deja elegirla).
2. **Exponer con duplicados, galaxias ajenas o más de seis:** `400`/`404` y nada cambia → Tarea 3.
3. **Visitas:** la propia no cuenta; volver el mismo día cuenta una vez; un nombre que no existe da `404 planetarium_not_found`; la respuesta no trae nada privado → Tarea 3.
4. **Seis legendarias holo expuestas:** el bonus se queda en el 5 %; una incursión guarda el bonus al empezar y cambiar lo expuesto a mitad no la toca → Tareas 1 y 3.
5. **Un planetario vacío visitado o destacado:** la visita enseña «Todavía no ha expuesto ninguna galaxia» y los destacados solo listan planetarios con algo expuesto → Tareas 3 y 4.

---

### Task 1: Reglas, configuración y API

**Files:**
- Create: `games/galaxy/packages/shared/src/planetarium/prestige.ts`, `games/galaxy/packages/shared/test/planetarium.test.ts`
- Modify: `games/galaxy/packages/shared/src/config/registry.ts`, `games/galaxy/packages/shared/src/api/planetarium.ts` (nuevo), `games/galaxy/packages/shared/src/errors.ts`, `games/galaxy/packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - clave viva `planetarium`: `{ slots: int 1–8 (6), points: { tiers: [5 ints] ([1, 2, 4, 7, 12]), finish: int (1) }, xpPerPoint: number (0.001), cap: number 0–0.05 (0.05), featured: int 1–24 (8) }`;
  - `prestige(exhibits: { tier: Tier; finish: Finish }[], cfg): number` (suma de `tiers[tier]` más `finish` si el acabado no es `normal`);
  - `planetariumBonus(points: number, cfg): number` = `min(cfg.cap, points × cfg.xpPerPoint)`, redondeado a 4 decimales;
  - tipos `PlanetariumView { slots, exhibits: (GalaxySummary | null)[], prestige, bonus, visits, featured: PlanetariumCard[] }`, `PlanetariumCard { owner: string; prestige: number; exhibits: number; cover: PublicGalaxy | null }`, `PlanetariumVisit { owner, exhibits: (PublicGalaxy | null)[], prestige, visits }`, `PublicGalaxy` (lo de `PulledGalaxy` más `level`);
  - `exhibitsSchema` (`{ galaxies: (uuid | null)[] }`, de 1 a 8, sin duplicados) y `usernameParamSchema`;
  - errores `galaxy_exhibited`, `planetarium_not_found`.

- [ ] **Step 1: pruebas que fallan** en `planetarium.test.ts`:
  - `prestige` de una común normal = 1, de una legendaria holo = 13, de nada = 0;
  - `planetariumBonus(16, defaults)` = 0.016; con seis legendarias holo (78 puntos) = 0.05;
  - el registro valida los valores por defecto y rechaza `cap: 0.06`;
  - `exhibitsSchema` rechaza dos veces el mismo id y más de 8 entradas.
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project unit packages/shared/test/planetarium.test.ts` → FAIL (módulo no existe).
- [ ] **Step 3:** implementar la clave, las funciones, los tipos y los errores.
- [ ] **Step 4:** la misma orden → PASS; `pnpm -C games/galaxy typecheck`.
- [ ] **Step 5:** commit `feat(galaxy): reglas, configuración y API del planetario`.

### Task 2: Migración y pgTAP

**Files:**
- Create: `supabase/migrations/<UTC>_galaxy_planetarium.sql` (nombre con `date -u +%Y%m%d%H%M%S`), `supabase/tests/980_galaxy_planetarium.test.sql`
- Modify: `games/galaxy/apps/server/src/db/schema.ts`

**Interfaces:**
- Produces:
  - `galaxy.exhibits (account_id uuid references galaxy.accounts on delete cascade, slot smallint check (slot between 1 and 8), galaxy_id uuid not null unique references galaxy.galaxies (id), primary key (account_id, slot))`;
  - `galaxy.planetarium_visits (owner_id uuid references galaxy.accounts on delete cascade, visitor_id uuid references galaxy.accounts on delete cascade, day date not null, primary key (owner_id, visitor_id, day), check (owner_id <> visitor_id))`;
  - permisos solo para `galaxy_api` (como el resto del esquema) y RLS activada sin políticas para `anon`/`authenticated`.

- [ ] **Step 1:** pgTAP (plan 7): las dos tablas, la clave única de `galaxy_id`, el `check` del pedestal (9 falla), el `check` de visitarse a uno mismo, la clave primaria de visitas (repetir el día falla) y que `anon` no puede leer.
- [ ] **Step 2:** `pnpm exec supabase test db` → FAIL.
- [ ] **Step 3:** migración; `pnpm exec supabase migration up`; tipos en `schema.ts`.
- [ ] **Step 4:** `pnpm exec supabase test db` → PASS.
- [ ] **Step 5:** commit `feat(galaxy): tablas del planetario y de sus visitas`.

### Task 3: Servidor

**Files:**
- Create: `games/galaxy/apps/server/src/planetarium/{service,routes}.ts`, `games/galaxy/apps/server/test/integration/planetarium.test.ts`
- Modify: `games/galaxy/apps/server/src/collection/service.ts` (bloqueo y columna `exhibited`), `games/galaxy/apps/server/src/runs/service.ts` (el bonus al empezar), `games/galaxy/apps/server/src/app.ts` (rutas)

**Interfaces:**
- Consumes: Task 1 (`prestige`, `planetariumBonus`, tipos, esquemas), Task 2 (tablas).
- Produces:
  - `GET /galaxy/api/planetarium` → `PlanetariumView`;
  - `PUT /galaxy/api/planetarium/exhibits` con `exhibitsSchema` → `PlanetariumView` (bloqueo `planetarium:<cuenta>`, reemplaza las filas en una transacción, comprueba que todas son suyas → `404 galaxy_not_found`);
  - `GET /galaxy/api/planetarium/visit/:username` → `PlanetariumVisit`; apunta la visita con `insert … on conflict do nothing` si el visitante no es el dueño;
  - `GalaxySummary.exhibited?: true`; desintegrar y fusionar lanzan `409 galaxy_exhibited` antes de cobrar;
  - `startRun` añade `{ stat: 'xp', value: bonus }` a `bonuses` si el bonus es mayor que 0.

- [ ] **Step 1:** integración que falla:
  - exponer tres galaxias y leer la vista (prestigio, bonus, pedestales en su orden);
  - duplicados → 400; una ajena → 404; nueve → 400; nada cambia;
  - desintegrar y fusionar una expuesta → 409 y el saldo igual;
  - visitar: 200 con solo lo expuesto (las claves de la respuesta son exactamente `owner, exhibits, prestige, visits`), dos visitas el mismo día cuentan 1, la propia 0, un nombre que no existe 404;
  - destacados: solo planetarios con algo expuesto, sin el propio, ordenados por prestigio, como mucho `featured`;
  - una incursión empieza con el bonus en `bonuses` y en `runs.upgrades`; cambiar lo expuesto después no cambia la fila guardada.
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project integration apps/server/test/integration/planetarium.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** la misma orden → PASS; toda la integración en verde.
- [ ] **Step 5:** commit `feat(galaxy): exponer galaxias, visitar planetarios y su bonus`.

### Task 4: Web

**Files:**
- Create: `games/galaxy/apps/web/src/planetarium/{PlanetariumScreen,VisitScreen,Dome}.tsx`, `games/galaxy/apps/web/src/api/planetarium.ts`, `games/galaxy/apps/web/test/planetarium.test.tsx`
- Modify: `games/galaxy/apps/web/src/app/routes.tsx`, `games/galaxy/apps/web/src/station/StationScreen.tsx` (la sala lleva a `/planetario`), `games/galaxy/apps/web/src/collection/*` (chapa «Expuesta», Desintegrar desactivado y no elegible en la fusión), `games/galaxy/apps/web/src/copy/es.ts`, `games/galaxy/apps/web/src/styles/app.css`, `games/galaxy/docs/DESIGN_SYSTEM.md`

**Interfaces:**
- Consumes: Task 3 (rutas y tipos).
- Produces: `usePlanetarium()`, `useSetExhibits()`, `useVisit(username)`; rutas `/planetario` y `/planetario/:username`.

- [ ] **Step 1:** pruebas que fallan en `planetarium.test.tsx`:
  - la cúpula con seis pedestales (`role="list"`, nombre «Pedestales»), los vacíos con «Exponer galaxia» y los llenos con la carta y «Retirar»;
  - el prestigio y «+1,6 % de experiencia en las incursiones»; «12 visitas»;
  - elegir una galaxia en el diálogo envía los seis pedestales en su orden;
  - el campo «Visitar un planetario» lleva a `/planetario/<nombre>`; los destacados enlazan a cada uno;
  - la visita enseña el nombre del dueño, sus cartas sin acciones y, vacía, «Todavía no ha expuesto ninguna galaxia»; un 404 dice «No hay ningún planetario con ese nombre»;
  - en la colección, una expuesta lleva «Expuesta», su Desintegrar está desactivado con la razón y la fusión no la deja elegir.
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project web apps/web/test/planetarium.test.tsx` → FAIL.
- [ ] **Step 3:** implementar. Consultar ui-ux-pro-max antes del CSS; §8 decies en `DESIGN_SYSTEM.md`.
- [ ] **Step 4:** la misma orden → PASS; web, typecheck y lint en verde; capturas a 1280, 1600 y 1920 revisadas.
- [ ] **Step 5:** commit `feat(galaxy): el planetario, sus pedestales y las visitas`.

### Task 5: Arte en Aseprite

**Files:**
- Create: `games/galaxy/art/planetarium/paint-planetarium.lua`, `games/galaxy/art/planetarium/dome.aseprite`, `games/galaxy/apps/web/src/planetarium/art/dome.png`, `games/galaxy/apps/web/test/planetarium-art.test.ts`
- Modify: `games/galaxy/apps/web/src/planetarium/Dome.tsx`

**Interfaces:**
- Produces: tira `dome.png` de 8 fotogramas de 192×96 (cúpula con su retícula, el proyector central girando y lanzando estrellas que se mueven por la cúpula, seis pedestales con su haz holográfico), reproducida con `steps(8)`.

- [ ] **Step 1:** prueba que falla en `planetarium-art.test.ts`: el PNG existe, mide 1536×96 y cada fotograma es distinto del anterior (el proyector gira).
- [ ] **Step 2:** la prueba → FAIL.
- [ ] **Step 3:** pintar con el script en modo batch (capas: cúpula, retícula, estrellas, proyector, pedestales, haces), exportar la tira y revisar la hoja de contacto.
- [ ] **Step 4:** la prueba → PASS; capturas revisadas.
- [ ] **Step 5:** commit `feat(galaxy): la cúpula del planetario pintada en Aseprite`.

### Task 6: e2e, documentación, verificación, revisión final, PR y PRE

- [ ] **e2e** (`planetarium.spec.ts`): dos cuentas nuevas con galaxias del escáner. La primera expone dos y ve su prestigio; la segunda la visita por nombre y la ve en los destacados; la primera ve «1 visita»; desintegrar una expuesta está desactivado; sin violaciones de CSP.
- [ ] **DEPLOY_PRE paso 13:** la migración, la clave `planetarium` y qué comprobar.
- [ ] **Verificación completa:** typecheck y lint; `pnpm -C games/galaxy test`; `GALAXY_CALIBRATE=1`; pgTAP; `TZ=UTC pnpm test:unit` en la raíz; todo el e2e; Docker y smoke.
- [ ] **Cierre:** revisor nuevo (opus) y una pasada de correcciones con TDD; PR a `develop`, CI y fusión; comprobación en PRE (si Cloudflare está bloqueado por el fútbol, esperar y reintentar); registro a docs y memoria.
