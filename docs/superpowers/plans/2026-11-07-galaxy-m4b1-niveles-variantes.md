# Galaxy M4b-1 · Niveles de sonda y variantes del arma inicial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada sonda sube del nivel 1 al 10 en el Hangar pagando componentes y monedas; cada nivel le da pequeñas mejoras de estadísticas y en los niveles 4 y 8 desbloquea una variante de su arma inicial, que el jugador elige y con la que sale a la incursión.

**Architecture:** Las variantes son armas completas del contenido de la simulación, marcadas con `variant: { of, unlockAt }`; la simulación arranca la sonda con la variante elegida y recibe los bonos del nivel como una fuente más de estadísticas, así que pasan por el rendimiento decreciente y los topes de §8.6. El servidor guarda el nivel y la variante por cuenta y sonda, cobra las subidas con una operación idempotente y fotografía bonos y variante al empezar cada incursión (`runs.upgrades`), igual que las reliquias. El Hangar enseña nivel, bonos, la subida con su coste y el selector del arma inicial, con ilustraciones animadas pintadas en Aseprite.

**Tech Stack:** pnpm workspace `games/galaxy`: `@galaxy/sim` (simulación determinista, Vitest), `@galaxy/shared` (Zod, configuración viva), `@galaxy/server` (Fastify + Kysely + Postgres), `@galaxy/web` (React 19, TanStack Query 5), migraciones y pgTAP en `supabase/` de la raíz, Playwright, Aseprite 1.3 por CLI con Lua.

**Spec:** `games/galaxy/docs/GDD.md` §6 (Mejoras), §5.3, §8.6, §11, §17.5; diseño en `games/galaxy/docs/DESIGN_SYSTEM.md` §8 ter (Hangar). El Laboratorio (§10.6) es M4b-2.

## Global Constraints

- TDD estricto: cada paso de código tiene antes su prueba que falla (Vitest, pgTAP, Playwright).
- La simulación es determinista: misma semilla y mismas entradas, mismo resultado; cambiar reglas sube `SIM_VERSION` (1.3.0 → 1.4.0).
- Los frenos de §8.6 se respetan: los bonos entran como fuente de estadísticas con rendimiento decreciente y topes; el campo de pruebas de `builds.test.ts` no se pasa de sus techos.
- Nada de dinero fuera de `credit`/`debit` en la misma transacción; las acciones que cobran van en `runOperation` con clave de idempotencia; ningún saldo baja de 0.
- Copy en español, tú, títulos directos sin símbolos especiales (·, :, —, →) y sin punto final; cada código de error nuevo tiene su texto en `copy/es.ts`.
- Antes de CSS nuevo se consulta ui-ux-pro-max y se actualiza `DESIGN_SYSTEM.md`; respetar `prefers-reduced-motion`; foco visible.
- Arte de muestra en Aseprite (memoria del usuario 2026-11-07): ilustraciones pintadas con Lua en Aseprite, fuentes `.aseprite` en `games/galaxy/art/`, tiras PNG en la web.
- La BD local es del usuario: `pnpm exec supabase migration up` y `pnpm exec supabase test db`; nunca `db reset`. Las pruebas escriben solo cuentas `e2e_*` o de prueba.
- Commits en español, convencionales, con las líneas de coautoría de la sesión.

## Review Focus

1. **Subidas a la vez, repetidas o con vista vieja:** una clave repetida devuelve lo mismo; dos claves distintas no compran dos niveles por uno; una vista vieja (otra pestaña) da `409 probe_changed` sin cobrar → Tarea 4.
2. **Subir una sonda que no tienes, o ya al máximo:** `409 probe_locked` / `409 probe_maxed`, nada cobrado → Tarea 4.
3. **Una variante guardada que ya no vale** (el contenido vivo cambió su `unlockAt` o la quitó): la incursión sale con el arma base y `variant: null`, sin fallar → Tareas 2 y 4.
4. **La variante y su base en la misma partida:** nunca se ofrece la base como arma nueva si llevas su variante; la variante evoluciona en la evolución de su base y deja su hueco → Tarea 1.
5. **El nivel 10 con las builds extremas:** el campo de pruebas con los bonos del nivel 10 sigue bajo los techos de daño → Tarea 1.

---

## File Structure

- `games/galaxy/packages/sim/src/content/schema.ts`, `content/default.ts`: `variant` en las armas y las 16 variantes.
- `games/galaxy/packages/sim/src/types.ts`, `sim.ts`, `systems/stats.ts`, `systems/upgrades.ts`, `version.ts`: arranque con variante, bonos como fuente, ofertas y evoluciones.
- `games/galaxy/packages/shared/src/probes/levels.ts` (nuevo): reglas puras de niveles y variantes.
- `games/galaxy/packages/shared/src/config/registry.ts`: `probes.levels`.
- `games/galaxy/packages/shared/src/api/runs.ts`, `errors.ts`, `probes/unlocks.ts`: tipos y esquemas.
- `supabase/migrations/<ts>_galaxy_probe_levels.sql`, `supabase/tests/977_galaxy_probe_levels.test.sql`.
- `games/galaxy/apps/server/src/runs/levels.ts` (nuevo), `runs/hangar.ts`, `runs/routes.ts`, `runs/service.ts`, `db/schema.ts`.
- `games/galaxy/apps/web/src/api/runs.ts`, `hangar/HangarScreen.tsx`, `hangar/weapons.ts` (nuevo), `arena/ArenaScreen.tsx`, `arena/sprites/icons.ts`, `copy/es.ts`, `styles/app.css`.
- `games/galaxy/art/weapons/paint-weapons.lua` (nuevo) y sus `.aseprite`; tiras en `games/galaxy/apps/web/src/hangar/weapons/`.
- `games/galaxy/apps/web/e2e/probe-levels.spec.ts` (nuevo); `games/galaxy/docs/DEPLOY_PRE.md` paso 10.

---

### Task 1: Variantes y bonos en la simulación

**Files:**
- Modify: `games/galaxy/packages/sim/src/content/schema.ts`, `content/default.ts`, `types.ts`, `sim.ts`, `systems/stats.ts`, `systems/upgrades.ts`, `version.ts`
- Test: `games/galaxy/packages/sim/test/variants.test.ts` (nuevo), `test/builds.test.ts`, `test/content.test.ts`

**Interfaces:**
- Produces:
  - En el esquema de arma: `variant?: { of: string; unlockAt: 4 | 8 }`. El contenido valida que `of` es un arma base (sin `evolution` ni `variant`) y que cada base tiene como mucho una variante por `unlockAt`.
  - `SimOptions.probes[i]` gana `bonuses?: StatBonus[]` y `variant?: string | null`. `ProbeState` gana `upgrades: StatBonus[]`.
  - `baseOf(content: Content, weaponId: string): string` (exportada desde `systems/upgrades.ts` y el índice): la base de una variante, o el propio id.
  - `SIM_VERSION = '1.4.0'`.

- [ ] **Step 1: Pruebas que fallan** (`variants.test.ts`):
  - `'cada arma inicial tiene dos variantes, en los niveles 4 y 8'`: para las 8 sondas de `DEFAULT_CONTENT`, las armas con `variant.of === probe.weapon` son 2, con `unlockAt` 4 y 8.
  - `'una variante rinde parecido a su base'`: para cada variante, el DPS nominal del último nivel (`damage × max(count,1) / cooldown`) está entre 0,75 y 1,15 veces el de su base.
  - `'la sonda sale con la variante elegida'`: `createSim({ …, probes: [{ probe: 'lumen', relics: [], variant: 'pulse-twin' }] })` → `sim.probes[0].weapons[0].id === 'pulse-twin'`.
  - `'una variante que no es de su arma no vale'`: `variant: 'nova-wide'` con `lumen` lanza `RangeError` cuyo mensaje empieza por `bad_variant`.
  - `'los bonos suben las estadísticas con rendimiento decreciente'`: con `bonuses: [{ stat: 'maxHp', value: 0.27 }, { stat: 'damage', value: 0.18 }]`, `stats.maxHp > def.hp` y `stats.damage > 1`, y ambos menores que sin rendimiento decreciente (`def.hp × 1,27`, `1,18`) o iguales si el tope no muerde.
  - `'nunca se ofrece la base si llevas su variante'`: con `pulse-twin` en el hueco, 200 ofertas seguidas (con `offerFor` y `applyOffer` aplicando la primera) no contienen `{ kind: 'weapon', id: 'pulse', level: 1 }`, y sí aparecen subidas de `pulse-twin`.
  - `'la variante al máximo evoluciona en la evolución de su base'`: `pulse-twin` al nivel máximo más el requisito de `pulse-storm` → la primera oferta es `{ kind: 'evolve', id: 'pulse-storm' }`, y al aplicarla el hueco de la variante pasa a `pulse-storm`.
  - En `content.test.ts`: el contenido por defecto sigue pasando el esquema tal cual, y uno con una variante de una evolución (o dos variantes con el mismo `unlockAt`) no lo pasa.
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project unit packages/sim/test/variants.test.ts packages/sim/test/content.test.ts`. Esperado: FALLAN.
- [ ] **Step 3: Implementar.** Las 16 variantes, con un ayudante en `default.ts` `variantOf(baseId, spec)` que copia los niveles de la base y aplica multiplicadores y sumas:

  | Base | Nivel 4 | Nivel 8 |
  |---|---|---|
  | `pulse` | `pulse-twin` «Pulso doble»: count +1, daño ×0,6 | `pulse-frost` «Pulso gélido»: elemento `slow`, daño ×0,85 |
  | `nova` | `nova-wide` «Onda amplia»: área ×1,35, enfriamiento ×1,2 | `nova-ember` «Onda ígnea»: elemento `burn`, daño ×0,85 |
  | `arc` | `arc-chain` «Arco encadenado»: rebotes +2, daño ×0,75 | `arc-shock` «Arco eléctrico»: elemento `shock`, daño ×0,85 |
  | `drone` | `drone-pair` «Dron doble»: count +1, daño ×0,6 | `drone-leech` «Dron vampiro»: elemento `leech`, daño ×0,85 |
  | `field` | `field-wide` «Pozo amplio»: área ×1,3, daño ×0,8 | `field-corrosion` «Pozo corrosivo»: elemento `corrosion`, daño ×0,85 |
  | `beam` | `beam-split` «Rayo partido»: count +1, daño ×0,6 | `beam-prism` «Rayo prismático»: elemento `prism`, daño ×0,85 |
  | `boomerang` | `boomerang-twin` «Disco gemelo»: count +1, daño ×0,6 | `boomerang-breach` «Disco perforante»: elemento `breach`, perforación +2, daño ×0,8 |
  | `turret` | `turret-rapid` «Torreta rápida»: enfriamiento ×0,65, daño ×0,65 | `turret-hack` «Torreta pirata»: elemento `hack`, daño ×0,85 |

  Cada variante lleva una descripción de una línea («Dispara dos rayos a la vez, más flojos») y, hasta la Tarea 6, el icono de su base. En las ofertas, una variante solo se ofrece para subir si ya la llevas, y una base no se ofrece nueva si llevas su variante. Las evoluciones buscan el hueco por `baseOf`. Los bonos entran en `contributions` como fuente.
- [ ] **Step 4: El campo de pruebas con el nivel 10.**
  - `randomBuild` trata las variantes como armas base (su raíz es `baseOf`).
  - Cada build se juega con los bonos del nivel 10 por defecto: `[{ maxHp: 0.27 }, { damage: 0.18 }]`. El comentario apunta a `probes.levels` de la Tarea 2.
  - Ejecutar `pnpm -C games/galaxy exec vitest run --project unit packages/sim`. Esperado: PASAN, y `builds.test.ts` bajo sus techos. Si un techo se pasa, se ajusta el contenido de la variante, no el techo.
- [ ] **Step 5: Commit** `feat(galaxy): variantes del arma inicial y bonos de nivel en la simulación`.

### Task 2: Reglas de niveles y variantes, configuración y API

**Files:**
- Create: `games/galaxy/packages/shared/src/probes/levels.ts`
- Modify: `packages/shared/src/config/registry.ts` (`probes.levels`), `api/runs.ts`, `errors.ts`, `probes/unlocks.ts`, `index.ts`
- Test: `games/galaxy/packages/shared/test/probe-levels.test.ts` (nuevo), `test/registry.test.ts`

**Interfaces:**
- Consumes: `StatBonus`, `WeaponDef`, `Content`, `baseOf` de `@galaxy/sim` (Tarea 1).
- Produces:
  - Configuración `probes.levels`:
    ```ts
    {
      perLevel: Partial<Record<StatKey, number>>, // por defecto { maxHp: 0.03, damage: 0.02 }
      costs: { components: number; coins: number }[], // índice i = llegar al nivel i + 2
    }
    ```
    Valores por defecto de `costs`:
    - componentes: `[20, 35, 60, 90, 130, 180, 240, 310, 400]`;
    - monedas: `[300, 600, 1000, 1600, 2400, 3400, 4600, 6000, 8000]`.

    El nivel máximo es `costs.length + 1`, es decir 10.
  - Reglas puras:
    - `probeMaxLevel(cfg: ProbesConfig): number`.
    - `probeLevelBonuses(level: number, cfg: ProbesConfig): StatBonus[]`. Da `[]` en el nivel 1 y `perLevel[k] × (level − 1)` por estadística, acotado a `[1, max]`.
    - `probeLevelNext(level: number, cfg: ProbesConfig): { components: number; coins: number } | null`.
    - `variantsOf(weaponId: string, content: Content): WeaponDef[]`, ordenadas por `unlockAt`.
    - `startingWeapon(probe: ProbeDef, level: number, chosen: string | null, content: Content): string`. Devuelve `chosen` si es variante del arma de la sonda y `level ≥ unlockAt`; si no, el arma base.
  - Tipos de la API:
    - `ProbeVariantCard = { id; name; description; icon; unlockAt: number; unlocked: boolean; element: string | null }`. La base va primera, con `unlockAt: 1`.
    - `ProbeCard` gana `level`, `maxLevel`, `next: { components; coins } | null`, `bonuses: StatBonus[]`, `variant: string` (el arma con la que saldría) y `variants: ProbeVariantCard[]`.
    - `RunStart` gana `bonuses: StatBonus[]` y `variant: string | null`.
  - Esquemas:
    - `probeLevelUpSchema = z.object({ level: z.number().int().min(2).max(20) }).strict()`;
    - `probeVariantSchema = z.object({ variant: contentId }).strict()`.
  - Códigos de error: `probe_changed`, `probe_maxed` y `variant_locked`, más `probe_locked` si no existe ya.
  - `probeCards(content, assigned, stats, cfg, levels: Record<string, { level: number; variant: string | null }>)`.

- [ ] **Step 1: Pruebas que fallan:**
  - nivel 1 sin bonos; nivel 10 → `[{ stat: 'maxHp', value: 0.27 }, { stat: 'damage', value: 0.18 }]` (con `toBeCloseTo`);
  - `probeLevelNext(1)` → `{ components: 20, coins: 300 }`, `probeLevelNext(9)` → `{ 400, 8000 }`, `probeLevelNext(10)` → `null`;
  - `startingWeapon(lumen, 3, 'pulse-twin')` → `'pulse'`; con nivel 4 → `'pulse-twin'`; `'nova-wide'` con lumen → `'pulse'`; `null` → `'pulse'`;
  - `probeCards` con `{ lumen: { level: 4, variant: 'pulse-twin' } }` da a Lumen `level 4`, `variant 'pulse-twin'`, tres `variants` con la primera desbloqueada y la del nivel 8 cerrada; una sonda sin fila sale en el nivel 1;
  - los valores por defecto de `probes.levels` en `registry.test.ts`, y que los bonos del nivel 10 son los que prueba `builds.test.ts`;
  - `copy.errors` tiene texto para los códigos nuevos (la prueba de errores que ya existe).
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project unit packages/shared`. Esperado: FALLAN.
- [ ] **Step 3: Implementar** las reglas, la configuración, los tipos y los textos de error:
  - `probe_changed`: «Esa sonda ya había cambiado de nivel. Míralo y vuelve a intentarlo»;
  - `probe_maxed`: «Esa sonda ya está al nivel máximo»;
  - `variant_locked`: «Esa variante se abre en un nivel más alto».
- [ ] **Step 4:** La misma orden. Esperado: PASAN. Typecheck limpio. Lo que rompa en el servidor y la web por los campos nuevos se arregla en sus fixtures.
- [ ] **Step 5: Commit** `feat(galaxy): reglas de los niveles de sonda y sus variantes`.

### Task 3: Tabla de niveles y foto de mejoras en las incursiones

**Files:**
- Create: `supabase/migrations/<timestamp UTC>_galaxy_probe_levels.sql`, `supabase/tests/977_galaxy_probe_levels.test.sql`
- Modify: `games/galaxy/apps/server/src/db/schema.ts`

**Interfaces:**
- Produces:
  - `galaxy.probe_levels`, una fila por cuenta y sonda que la ha cambiado (sin fila = nivel 1, arma base):
    - `account_id uuid`, que referencia a `galaxy.accounts` con `on delete cascade`;
    - `probe text`, con `check (probe ~ '^[a-z0-9-]{1,32}$')`;
    - `level smallint not null default 1 check (level between 1 and 20)`;
    - `variant text null`, con el mismo check;
    - `updated_at timestamptz not null default now()`;
    - primary key `(account_id, probe)`.
  - Permisos: RLS activado y una política para `galaxy_api`; `select, insert, update` para `galaxy_api`; revocado a `public`, `anon`, `authenticated` y `service_role`.
  - `galaxy.runs.upgrades jsonb not null default '{}'::jsonb`.

- [ ] **Step 1:** pgTAP que falla:
  - la tabla y sus columnas existen, con la clave primaria;
  - RLS activado;
  - `level` 0 y 21 se rechazan;
  - `galaxy_api` no puede borrar, y `anon` y `service_role` no pueden leer;
  - `runs.upgrades` existe y su valor por defecto es `{}`.
- [ ] **Step 2:** `pnpm exec supabase test db` (en la raíz). Esperado: el archivo 977 FALLA y el resto pasa.
- [ ] **Step 3:** Escribir la migración y aplicarla con `pnpm exec supabase migration up`. Añadir `ProbeLevelsTable` y `upgrades` en `RunsTable` en `db/schema.ts`.
- [ ] **Step 4:** `pnpm exec supabase test db`. Esperado: PASA todo.
- [ ] **Step 5: Commit** `feat(galaxy): tabla de niveles de sonda`.

### Task 4: El servidor sube niveles, guarda la variante y la lleva a la incursión

**Files:**
- Create: `games/galaxy/apps/server/src/runs/levels.ts`
- Modify: `apps/server/src/runs/hangar.ts`, `runs/routes.ts`, `runs/service.ts`
- Test: `games/galaxy/apps/server/test/integration/probe-levels.test.ts` (nuevo), `test/integration/hangar.test.ts`, `test/integration/runs.test.ts`

**Interfaces:**
- Consumes: Tareas 2 y 3.
- Produces:
  - `probeLevels(db, accountId): Promise<Record<string, { level: number; variant: string | null }>>`.
  - `levelUpProbe(deps, trx, accountId, probe: string, level: number, key: string): Promise<HangarView>`, en este orden:
    1. toma `pg_advisory_xact_lock('probes:' + accountId)`;
    2. si la sonda no está desbloqueada → 409 `probe_locked`;
    3. si está al máximo → 409 `probe_maxed`;
    4. si `level !== actual + 1` → 409 `probe_changed`;
    5. cobra con `debit` `components` y `coins`, motivo `'probe_level'`, referencia `{ probe, level }`, y hace upsert de la fila.
  - `chooseVariant(deps, accountId, probe: string, variant: string): Promise<HangarView>`:
    - 400 `invalid_input` si no es la base ni una variante del arma de la sonda;
    - 409 `variant_locked` si el nivel no llega;
    - elegir la base guarda `variant = null`.
  - Rutas:
    - `POST /galaxy/api/hangar/probes/:id/level-up` con `{ level }`: sesión primero, clave de idempotencia, `runOperation`, límite `hangar_level` 60/60.
    - `PUT /galaxy/api/hangar/probes/:id/variant` con `{ variant }`: límite `hangar_variant` 60/60.
  - `startRun` guarda en `runs.upgrades` `{ bonuses, variant }` (con `variant: null` si sale con la base, según `startingWeapon`) y lo devuelve en `RunStart`.

- [ ] **Step 1: Pruebas que fallan** (`probe-levels.test.ts`, con `give` como en `station.test.ts`):
  - `'subir la sonda de la prueba al nivel 2 cuesta 20 componentes y 300 monedas, y el Hangar lo enseña'`;
  - `'sin fondos 402 y nada cambia'`;
  - `'una vista vieja da probe_changed y no cobra'`: subir a 2, y otra vez `{ level: 2 }` con clave nueva → 409 y la cartera igual;
  - `'una clave repetida devuelve lo mismo y cobra una vez'`;
  - `'dos subidas a la vez con claves distintas al mismo nivel: una pasa y la otra da probe_changed'`;
  - `'una sonda sin desbloquear da probe_locked'` y `'al nivel 10, probe_maxed'` (con `give` de sobra y 9 subidas);
  - `'la variante del nivel 4: cerrada en el 3 (variant_locked), elegible en el 4, y volver a la base guarda null'`;
  - `'la incursión sale con los bonos del nivel y la variante elegida, y los guarda'`: `RunStart.bonuses` igual a `probeLevelBonuses(4)`, `RunStart.variant === 'pulse-twin'`, y `runs.upgrades` en la BD igual;
  - `'una variante guardada que ya no vale sale como la base'`: poner a mano `level 3, variant 'pulse-twin'` en la fila → `RunStart.variant === null`;
  - `'sin sesión 401, antes que validar el cuerpo'`.
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project integration apps/server/test/integration/probe-levels.test.ts`. Esperado: FALLAN.
- [ ] **Step 3:** Implementar `levels.ts`, las rutas, la vista del Hangar con `probeLevels` y la foto en `startRun`.
- [ ] **Step 4:** La misma orden y la integración entera (`--project integration`). Esperado: PASAN. Hay que ajustar las expectativas de `hangar.test.ts` y `runs.test.ts` a los campos nuevos.
- [ ] **Step 5: Commit** `feat(galaxy): subir de nivel las sondas y elegir su arma inicial`.

### Task 5: El Hangar enseña el nivel, la subida y el arma inicial

**Files:**
- Modify: `games/galaxy/apps/web/src/api/runs.ts` (donde vive `useHangar`), `hangar/HangarScreen.tsx`, `arena/ArenaScreen.tsx` (y su ayudante de opciones), `copy/es.ts`, `styles/app.css`, `games/galaxy/docs/DESIGN_SYSTEM.md` §8 ter
- Test: `games/galaxy/apps/web/test/hangar.test.tsx`, `test/sim-options.test.ts` (nuevo), capturas en `test/browser/hangar.browser.test.ts`

**Interfaces:**
- Consumes:
  - `ProbeCard.level`, `maxLevel`, `next`, `bonuses`, `variant` y `variants`;
  - las rutas de la Tarea 4;
  - `RunStart.bonuses` y `RunStart.variant`.
- Produces:
  - `useLevelUpProbe()`: `mutate({ probe, level })`, con la intención `hangar:level:<probe>:<level>`, `keyFor`/`endIntent`, `setQueryData` del Hangar e invalidar la cartera;
  - `useChooseVariant()`: `mutate({ probe, variant })`.

- [ ] **Step 1: Pruebas que fallan:**
  - el panel de la sonda dice «Nivel 3 de 10» y «+6 % de vida y +4 % de daño»;
  - «Subir a nivel 4» lleva su coste («60 componentes y 1000 monedas»);
  - sin fondos está desactivado y dice «Te faltan…» (reutilizar `copy.station.missing`);
  - pulsarlo envía `{ level: 4 }` con su clave;
  - al nivel 10 dice «Nivel máximo»;
  - «Arma inicial» es un `radiogroup` con la base y sus dos variantes:
    - la del nivel 8, cerrada, dice «Se abre en el nivel 8» y está desactivada;
    - elegir la del nivel 4 envía `PUT …/variant` y la marca elegida;
  - la arena crea la simulación con `bonuses` y `variant` de `RunStart`. Las opciones salen de un ayudante puro `simOptions(run: RunStart): SimOptions` en `arena/ArenaScreen.tsx` (o un módulo propio) que `sim-options.test.ts` prueba.
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project web apps/web/test/hangar.test.tsx`. Esperado: FALLAN.
- [ ] **Step 3: Implementar.** Antes de escribir CSS, consultar ui-ux-pro-max: estado elegido, opciones desactivadas, foco en un radiogroup. Copy:
  - `level(n, max)`: «Nivel 3 de 10»;
  - `levelUp(n)`: «Subir a nivel 4»;
  - `levelMax`: «Nivel máximo»;
  - `bonuses(list)`: «+6 % de vida y +4 % de daño», a partir de un nombre por estadística en `copy.stats`;
  - `startingWeapon`: «Arma inicial»;
  - `variantLocked(n)`: «Se abre en el nivel 8»;
  - `chosen`: «Elegida».

  Escribir §8 ter en `DESIGN_SYSTEM.md`: el bloque de nivel con sus pips (llenos en Terminal y vacíos en `--panel-lip`), el botón Solar con su coste, y las tarjetas de arma (ilustración, nombre, qué hace y nivel que la abre) como `radio` con borde Solar al estar elegidas.
- [ ] **Step 4:** La suite web, el typecheck y el lint. Capturas del Hangar a 1280, 1600 y 1920 con Lumen en el nivel 4 y la variante del 4 elegida, revisadas. Esperado: PASAN.
- [ ] **Step 5: Commit** `feat(galaxy): el Hangar sube de nivel la sonda y elige su arma inicial`.

### Task 6: Ilustraciones de las armas en Aseprite e iconos de las variantes

**Files:**
- Create: `games/galaxy/art/weapons/paint-weapons.lua`, sus `.aseprite`, las tiras en `games/galaxy/apps/web/src/hangar/weapons/<id>.png`, `apps/web/src/hangar/weapons.ts`
- Modify: `apps/web/src/arena/sprites/icons.ts`, `packages/sim/src/content/default.ts` (iconos de las variantes), `hangar/HangarScreen.tsx`, `styles/app.css`, `docs/DESIGN_SYSTEM.md`
- Test: `games/galaxy/apps/web/test/weapon-art.test.ts` (nuevo), `test/sprites.test.ts`

**Interfaces:**
- Consumes: los ids de la Tarea 1.
- Produces:
  - `weaponArtUrl(id: string): string | undefined` y `WEAPON_FRAMES = 4` en `hangar/weapons.ts`. Usa `import.meta.glob('./weapons/*.png', { query: '?no-inline' })`, como la estación.
  - Iconos `icon-<variante>` de 12×12 en `ICONS`:
    - una variante elemental es el icono de su base reteñido al color de su elemento;
    - una de cantidad o forma lleva su marca, por ejemplo el trazo duplicado.

- [ ] **Step 1: Pruebas que fallan:**
  - las 8 armas iniciales y sus 16 variantes tienen su tira de 4 fotogramas de 32×32 (128×32, leído de la cabecera PNG) y no sobra ninguna;
  - cada variante del contenido tiene su `icon-<id>` en `SPRITES`, y es distinto del de su base.
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project web apps/web/test/weapon-art.test.ts apps/web/test/sprites.test.ts`. Esperado: FALLAN.
- [ ] **Step 3: Pintar en Aseprite** con Lua: rampas con sombra fría, luz cálida y brillo, 4 fotogramas en bucle.
  - Cada ilustración enseña el arma en acción sobre fondo oscuro: el rayo, la onda, el arco que rebota, el dron, el pozo, el rayo continuo, el disco y la torreta.
  - Las variantes enseñan su diferencia: doble, más amplia, encadenada, o con la tinta y las partículas de su elemento.
  - Las capas son fondo, arma y efectos, y los fuentes quedan en `art/weapons/`.
  - Ejecutar `aseprite -b --script-param out=art/weapons --script-param web=apps/web/src/hangar/weapons --script art/weapons/paint-weapons.lua`.
  - Revisar una hoja de contacto a ×4.
  - Las tarjetas del Hangar las reproducen con `steps(4)` a ×2 o ×3, y quietas con movimiento reducido.
  - `.dockerignore` ya excluye `art`.
- [ ] **Step 4:** La suite web y las capturas del Hangar, revisadas. Esperado: PASAN.
- [ ] **Step 5: Commit** `feat(galaxy): las armas iniciales y sus variantes pintadas en Aseprite`.

### Task 7: e2e, documentación, verificación, revisión final, PR y PRE

- [ ] **e2e** (`probe-levels.spec.ts` nuevo). Una cuenta nueva (con el test saltado) lee su sonda del Hangar y entonces:
  - con `grant <user> components 20` y `coins 300`, «Subir a nivel 2» lleva a «Nivel 2 de 10»;
  - con los componentes y monedas de los niveles 3 y 4 concedidos, sube a 4 y elige la variante del nivel 4;
  - `POST /galaxy/api/runs` devuelve esa `variant` y `bonuses` no vacíos;
  - no hay violaciones de CSP.
- [ ] **DEPLOY_PRE paso 10:**
  - la migración;
  - `probes.levels` en la configuración viva;
  - qué comprobar;
  - las cuentas de antes salen en el nivel 1, con su arma base.
- [ ] **Verificación completa:**
  - typecheck y lint;
  - `pnpm -C games/galaxy test`;
  - `GALAXY_CALIBRATE=1` del campo de pruebas;
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
