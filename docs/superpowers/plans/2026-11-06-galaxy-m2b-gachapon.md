# Galaxy Survivor · M2b: gachapón, colección y cartas · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (decidido: ejecución directa, `feedback-direct-execution`). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El primer bucle de colección jugable en PRE: entras, ves tu estación (pantalla de título), tiras en el Escáner profundo con un revelado espectacular, las galaxias llegan a tu colección como cartas TCG, las inspeccionas en 3D, y las desintegras en polvo o fusionas cinco en una de rareza superior. Todo lo decide el servidor, con economía de libro de movimientos e idempotencia.

**Architecture:**
- **Reglas puras** (`packages/shared/src/gacha/*`): probabilidades por nivel con suerte creciente y garantía, acabado, generación de la galaxia de un nivel (semillas candidatas hasta caer en la banda de puntuación), fusión y desintegración. Sin E/S, con RNG del motor (`subRng`), probadas con fast-check y simulación.
- **Motor** (`packages/engine`): nombres propios (port de `naming.py`) y rareza (puntuación por información y bandas calibradas offline, `calibration.json` generado).
- **Servidor** (`apps/server/src/{economy,gacha,collection}`): monedero sobre un libro de movimientos de solo añadir, operaciones idempotentes por clave, estado de suerte por cuenta y grupo, tiradas auditadas. Transacciones Kysely con `FOR UPDATE`.
- **Web** (`apps/web/src/{hub,scanner,collection,cards}`): pantalla de título (centro de navegación), Escáner profundo con revelado, colección en rejilla con cartas CSS 3D, inspector three.js cargado bajo demanda, sonido sintetizado mínimo del revelado.

**Tech Stack:** TypeScript, Zod, Kysely + Postgres (Supabase local/PRE), Fastify, React 19 + TanStack Query, el motor `@galaxy/engine` (Worker + WebGL2), three.js (solo el inspector), WebAudio, Vitest (+ fast-check), pgTAP, Playwright.

**Spec:**
- `games/galaxy/docs/GDD.md`: §4 (título y navegación), §7 (generación, rareza, acabado, auditoría), §8.1 (cartas), §8.5 (fusionar y desintegrar), §9 (gachapón completo), §11.1–11.3 (economía y reglas del servidor), §16.3 (configuración viva), §17.3–17.4 (juice y audio del gachapón), §18.5 (base de datos).
- `games/galaxy/docs/DESIGN_SYSTEM.md` (todo el frontend) y la demo aprobada `.superpowers/brainstorm/1011-1793971787/content/titulo-v2.html` (pantalla de título).
- Autoridad: el usuario concedió autonomía total hasta la beta (2026-11-06): este plan lo apruebo yo y las dudas se resuelven con *rulings*.

## Decisiones de alcance (rulings del plan)

1. **M2b va en un PR.** Si la revisión final lo recomienda, el inspector three.js puede salir en un PR aparte sin bloquear el resto.
2. **Fondo de la pantalla de título:** el de galaxias del motor (M2a), alimentado con las mejores galaxias del jugador (aleatorias si no tiene). No la escena pixel art con la estación de §4: el usuario la rechazó para el acceso y pidió «más misterioso».
3. **Lo que aún no existe se ve, bloqueado:** Jugar, Supervivencia, Hogar, Sondas, Logros, Clan, Ranking, Códice, Mercado, buzón y Comunidad aparecen con la etiqueta «En desarrollo» (el patrón de §4 para el cooperativo). La columna derecha muestra el resumen de tu colección hasta que llegue la clasificación (M5).
4. **Tiradas de bienvenida:** sin tutorial ni incursiones (M7, M3), la primera visita al Escáner da **10 señales de bienvenida** (idempotente). La garantía de bienvenida asegura la primera Legendaria en ≤ 10 tiradas.
5. **Monedas en PRE:** solo salen de la bienvenida y del CLI `grant` (auditado) hasta M3. No hay compra con dinero real (antiobjetivo).
6. **Niveles de reliquia (§8.4 bis) y exponer en el planetario (§8.5)** se quedan para M3a y M4: la tabla `galaxies` ya tiene `level` (1) para no migrar después.
7. **Sonido:** solo el del revelado (clac Perkins y acorde por rareza), sintetizado con WebAudio y con botón de silencio. La música y el resto del audio son M8.
8. **Nombre y designación:** nombre propio del motor (flujo `name`, port exacto de `proper_name`); designación `GX-` + 6 primeros hex del DNA en mayúsculas.

## Global Constraints

- **Rama** `feature/galaxy-m2b` desde `develop` (8254cc2). Commits en español, convencionales, con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PR a `develop`; se fusiona con el CI en verde y se verifica PRE.
- **TDD estricto.** Reglas con fast-check (`fc.assert`, ≥ 200 casos) y simulaciones deterministas; BD con pgTAP (`supabase/tests/972_galaxy_economy.test.sql` y siguientes); e2e con Playwright.
- **El servidor decide todo** (§11.3): el cliente solo pide. Semillas de tirada con `crypto.randomBytes(8)` → `bigint`; nunca `Math.random`. Las reglas usan `subRng(pullSeed, …)` del motor.
- **Economía:** cada acción es una operación con **clave de idempotencia** (`Idempotency-Key`, UUID del cliente). El libro `galaxy.ledger` es de solo añadir; los saldos nunca bajan de 0 (CHECK + comprobación en la transacción). Repetir una clave devuelve el mismo resultado; la misma clave con otra petición es `409 idempotency_conflict`.
- **Configuración viva:** todo número de partida está en `configSchemas` (`gacha`, `galaxies`, `economy` y el interruptor `features.gacha`), con los valores de abajo como defecto. Cada tirada guarda la versión de configuración y `ENGINE_VERSION`.
- **Coherencia del motor:** una galaxia de tirada es SIEMPRE `renderFromSeed(seed)` sin rasgos fijados: el servidor rechaza semillas, nunca fija rasgos. Los rasgos guardados son `drawTraits(subRng(seed, 'traits'))`.
- **Día del juego:** medianoche de `Europe/Madrid`, calculada en el servidor con zona explícita (tirada gratis diaria).
- **Frontend:** consultar ui-ux-pro-max antes del CSS; tokens y componentes de `DESIGN_SYSTEM.md` (se amplía antes de usar algo nuevo); copy con las reglas de §9 (títulos sin símbolos ni punto final); `prefers-reduced-motion` en todo; CSP intacta (three.js y el sonido no la cambian).
- **BD local del usuario:** solo `supabase migration up` y `supabase test db`; nunca `db reset`. Migraciones con la fecha de creación real (nunca futura).
- **Valores de partida** (configuración por defecto):
  - Niveles: Común 0,50 · Poco común 0,28 · Rara 0,13 · Épica 0,06 · Legendaria 0,03.
  - Suerte creciente estándar: desde la tirada 8 sin Legendaria, +0,06 por tirada; garantía en la 20.
  - Bienvenida: base Legendaria 0,06, suerte desde la 5 (+0,15), garantía en la 10; acaba con la primera Legendaria.
  - Evento: destacado base 0,005, suerte desde la 30 (+0,04), garantía en la 45; el destacado es una Legendaria con el rasgo destacado. Contador por grupo (se conserva entre eventos del grupo).
  - Acabado: Normal 0,85 · Holo 0,10 · Prismático 0,035 · Relieve braille 0,013 · Corrupto 0,002.
  - Coste: 100 monedas o 1 señal por tirada; x10 = 900 monedas o 10 señales. Tirada gratis: 1 al día (estándar).
  - Desintegrar (polvo): 5 / 12 / 30 / 75 / 200 por nivel × acabado 1 / 1,5 / 2 / 2,5 / 5.
  - Fusión: 5 del mismo nivel + polvo 20 / 50 / 120 / 300 → 1 del siguiente. Las Legendarias no se fusionan.
  - Bienvenida: 10 señales.
  - Bandas de rareza: cuantiles de la puntuación 0,50 / 0,78 / 0,91 / 0,97; la Legendaria exige además un fenómeno.

## Review Focus

1. **Concurrencia e idempotencia:** doble clic, dos pestañas y reintentos de red con la misma clave nunca cobran dos veces, nunca dejan un saldo negativo y no desordenan la suerte → Tareas 4–6.
2. **Bordes de la suerte:** la garantía cae exactamente en la tirada 20 (10 en bienvenida, 45 en evento), los contadores se reinician con la Legendaria o el destacado, la bienvenida acaba con la primera Legendaria y la tirada gratis cambia a medianoche de Madrid, también con cambio de hora → Tareas 3 y 5.
3. **Lo que se ve es lo que se tiene:** los rasgos, el nombre y el DNA que guarda el servidor son exactamente los que el cliente obtiene de la semilla, y la rareza visible coincide con la guardada → Tareas 2, 3 y 9.
4. **Abuso de la fusión y la desintegración:** galaxias repetidas, ajenas, ya desintegradas o de niveles mezclados, fusión de Legendarias, y desintegrar y fusionar la misma galaxia a la vez → Tarea 6.
5. **Colección grande:** con 1 000 galaxias la rejilla pagina, renderiza solo las cartas visibles (sin avalancha de trabajos al Worker) y la caché sigue acotada → Tareas 7 y 10.

---

## File structure

```
games/galaxy/
  packages/engine/
    src/naming.ts                       (Tarea 2)  SYLLABLES, properName(rng)
    src/rarity/{score.ts,calibration.json}  (Tarea 2)  scoreTraits, bands
    scripts/calibrate-rarity.mjs        (Tarea 2)
    test/{naming,rarity}.test.ts
  packages/shared/src/
    gacha/{rules.ts,generate.ts,types.ts}   (Tarea 3)
    config/registry.ts                  (Tarea 1: gacha, galaxies, economy, features.gacha)
    api/{wallet,gacha,galaxies}.ts      (Tarea 1: tipos de petición y respuesta)
    errors.ts                           (Tarea 1: códigos nuevos)
  apps/server/src/
    economy/{wallet.ts,operations.ts,day.ts}   (Tarea 4)
    gacha/{service.ts,routes.ts}               (Tarea 5)
    collection/{service.ts,routes.ts}          (Tarea 6)
    cli.ts                                     (Tarea 4: grant)
  apps/web/src/
    api/economy.ts                      (Tarea 7)
    hub/{TitleScreen.tsx,TopBar.tsx,MainMenu.tsx,CollectionSummary.tsx}  (Tarea 7)
    cards/{GalaxyCard.tsx,CardBack.tsx,useGalaxyImage.ts,finishes.css}  (Tarea 8)
    collection/{CollectionScreen.tsx,GalaxyDetail.tsx,FuseDialog.tsx}   (Tarea 9)
    scanner/{ScannerScreen.tsx,Reveal.tsx,reveal-sequence.ts,sfx.ts}   (Tarea 10)
    inspector/{Inspector.tsx,scene.ts,holo.glsl.ts}                    (Tarea 11)
supabase/migrations/<fecha>_galaxy_economy_gacha.sql   (Tarea 4)
supabase/tests/972_galaxy_economy.test.sql             (Tarea 4)
tools/golden/export.py                                  (Tarea 2: nombres)
```

---

### Task 1: Contratos compartidos y configuración

**Files:** `packages/shared/src/config/registry.ts`, `src/api/{wallet,gacha,galaxies}.ts`, `src/errors.ts`, `src/index.ts`; test `packages/shared/test/{config-gacha,api}.test.ts`.

**Interfaces — Produces:**
- `configSchemas.gacha`: `{ tiers: { base: [5 probabilidades] }, standard: Pity, welcome: Pity & { signals: number }, featured: Pity, costs: { coins: number; coinsTen: number; signals: number }, dailyFree: boolean, finishes: [5 probabilidades], banners: Banner[] }` con `Pity = { base: number; softStart: number; softStep: number; hard: number }` y `Banner = { id; kind: 'standard' | 'event'; name; pityGroup; featured?: { trait: TraitKey; value: string }; startsAt?; endsAt?; currency: 'signal' | \`signal:${string}\` }`. Por defecto un único banner estándar `deep-scan`.
- `configSchemas.galaxies`: `{ disintegrate: { tier: [5], finish: [5] }, fusion: { count: 5, dust: [4] } }`.
- `configSchemas.features.gacha: boolean` (true).
- `TIERS = ['common','uncommon','rare','epic','legendary'] as const`, `FINISHES = ['normal','holo','prismatic','braille','corrupt'] as const`, `Currency = 'coins' | 'dust' | 'signal' | \`signal:${string}\``.
- Tipos API: `Wallet = Record<Currency, number>`; `GachaView` (banners abiertos, probabilidades efectivas de la próxima tirada por banner, contadores y garantía, tirada gratis disponible, costes, saldos); `PullRequest = { banner; count: 1 | 10; pay: 'coins' | 'signal' | 'free' }`; `PulledGalaxy = { id; seed: string; tier; finish; traits; name; designation; featured: boolean; pityBefore: number }`; `GalaxySummary`, `GalaxyDetail` (con `lineage`, `origin`, `createdAt`).
- Errores: `insufficient_funds`, `gacha_disabled`, `banner_closed`, `free_pull_used`, `invalid_fusion`, `galaxy_not_found`, `idempotency_conflict`, `idempotency_required`.

- [ ] **Step 1: Tests que fallan.** El esquema por defecto reproduce los valores de partida; las probabilidades de cada lista suman 1 (± 1e-9) o se rechazan; `hard ≥ softStart ≥ 1`; un banner de evento sin `featured` se rechaza; `currency` del evento empieza por `signal:`.
- [ ] **Step 2: Implementar y ver pasar** (`pnpm -C games/galaxy vitest run --project unit packages/shared`).
- [ ] **Step 3: Commit** `feat(galaxy): contratos y configuración del gachapón y la economía`.

### Task 2: Nombres y rareza en el motor

**Files:** `packages/engine/src/{naming.ts,rarity/score.ts,rarity/calibration.json}`, `scripts/calibrate-rarity.mjs`, `tools/golden/export.py` (nombres), test `packages/engine/test/{naming,rarity}.test.ts`.

**Interfaces — Produces:** `properName(rng: Generator): string` (port exacto de `naming.proper_name`, SYLLABLES de Python); `galaxyName(seed: bigint): string` = `properName(subRng(seed, 'name'))`; `scoreTraits(traits): number` (Σ −log2 de la frecuencia marginal de cada valor, ausente = `—`, en el orden de sorteo); `RARITY_BANDS: readonly [number, number, number, number]`; `tierOfScore(score, hasPhenomenon): Tier` (Legendaria solo con fenómeno; sin él, como mucho Épica).

- [ ] **Step 1: Exportar** 300 nombres de Python (`proper_name(sub_rng(token_seed(20261104, i), "name"))`) a `golden/v1/names.json` sin tocar los demás archivos (determinismo comprobado como en M2a).
- [ ] **Step 2: Tests que fallan:** nombres idénticos; `calibrate-rarity.mjs` es determinista (200 000 sorteos con `deriveSeed('rarity-calibration', i)`) y su salida coincide con `calibration.json`; con esa muestra, las bandas dejan 50/28/13/6/3 % (± 0,5 %) sin contar la regla del fenómeno; `scoreTraits` crece al cambiar un rasgo común por uno raro.
- [ ] **Step 3: Implementar, generar `calibration.json` y ver pasar.** El hash v1 del braille no cambia (`version.test`).
- [ ] **Step 4: Commit** `feat(galaxy): nombres propios y bandas de rareza del motor`.

### Task 3: Reglas del gachapón (puras)

**Files:** `packages/shared/src/gacha/{rules.ts,generate.ts,types.ts}`; añadir `@galaxy/engine` y `fast-check` (dev) a shared; test `packages/shared/test/gacha-{rules,generate,simulation}.test.ts`.

**Interfaces — Produces:**
- `type PityState = { sinceLegendary: number; sinceFeatured: number; welcome: boolean }`.
- `legendaryChance(n: number, pity: Pity): number` (n = número de esta tirada desde la última Legendaria, 1-based): `n >= hard ? 1 : base + max(0, n - softStart + 1) * softStep`, con tope 1.
- `tierWeights(state, cfg): number[5]` (el resto de niveles reescalados al quitar la Legendaria).
- `drawPull(pullSeed: bigint, state, banner, cfg): { tier; featured; finish; state: PityState }`: un double para el nivel (`subRng(pullSeed,'tier')`), uno para el destacado si es banner de evento, uno para el acabado (`subRng(pullSeed,'finish')`). La bienvenida termina con la primera Legendaria; el destacado reinicia `sinceFeatured` y también `sinceLegendary`.
- `generateGalaxy(pullSeed, tier, featured?): { seed: bigint; traits; dna; score; name }`: candidatas `deriveSeed(pullSeed, 'candidate', k)`, k = 0…, hasta que `tierOfScore(scoreTraits(traits), hasPhenomenon)` sea `tier` y, si hay destacado, `traits[trait] === value`; tope de 200 000 candidatas (`RangeError('tier_unreachable')`).
- `disintegrateYield(tier, finish, cfg): number`; `validateFusion(galaxies, cfg): { tier: Tier; dust: number } | { error }` (5 del mismo nivel, distintas, no Legendarias).

- [ ] **Step 1: Tests que fallan (fast-check):** probabilidades en [0,1] y suma 1; `legendaryChance(hard) = 1`; con cualquier secuencia de tiradas nunca hay más de `hard − 1` tiradas seguidas sin Legendaria (y `welcome.hard` en bienvenida); el estado tras una Legendaria tiene `sinceLegendary = 0`; `generateGalaxy` devuelve rasgos iguales a `drawTraits(subRng(seed,'traits'))` y del nivel pedido; mismas entradas → misma salida.
- [ ] **Step 2: Simulación determinista:** 200 000 tiradas estándar → media entre Legendarias en [9, 15] tiradas y máximo 20; 10 000 cuentas nuevas → primera Legendaria siempre ≤ 10; frecuencia de acabados dentro de ±3σ.
- [ ] **Step 3: Implementar y ver pasar.**
- [ ] **Step 4: Commit** `feat(galaxy): reglas puras del gachapón, la fusión y la desintegración`.

### Task 4: Base de datos y monedero

**Files:** `supabase/migrations/<fecha>_galaxy_economy_gacha.sql`, `supabase/tests/972_galaxy_economy.test.sql`, `apps/server/src/db/schema.ts`, `src/economy/{wallet.ts,operations.ts,day.ts}`, `src/cli.ts` (`grant`); tests `apps/server/test/integration/{wallet,cli-grant}.test.ts`, `test/unit/day.test.ts`.

**Tablas** (esquema `galaxy`, RLS activada con políticas para `galaxy_api`, permisos mínimos; `ledger`, `gacha_pulls` y `operations` sin UPDATE ni DELETE para `galaxy_api`):
- `balances(account_id, currency, amount bigint CHECK (amount >= 0), PK(account_id, currency))`.
- `ledger(id bigserial, account_id, currency, delta bigint, balance_after bigint, reason text, ref jsonb, operation_key text, created_at)`.
- `operations(account_id, key text, kind text, request_hash text, result jsonb, created_at, PK(account_id, key))`.
- `galaxies(id uuid, owner_id, seed numeric(20,0), engine_version, traits jsonb, dna, name, tier smallint, score real, finish text, level smallint DEFAULT 1, season text, origin text CHECK IN ('pull','fusion','grant'), lineage uuid[], pull_id, created_at, disintegrated_at)`, con índice parcial `(owner_id, tier, created_at) WHERE disintegrated_at IS NULL`.
- `gacha_accounts(account_id PK, welcome_granted_at, last_free_day date)`.
- `gacha_state(account_id, pity_group, since_legendary int, since_featured int, welcome bool, total_pulls int, PK(account_id, pity_group))`.
- `gacha_pulls(id, account_id, banner, pity_group, seed, tier, featured, finish, pity_before int, config_version int, engine_version, galaxy_id, operation_key, created_at)`.

**Interfaces — Produces:** `credit/debit(trx, accountId, currency, amount, reason, ref, opKey)` (bloquea la fila, escribe el libro, lanza `insufficient_funds`); `getWallet(db, accountId): Wallet`; `runOperation(db, accountId, key, kind, requestHash, fn)` (devuelve el resultado guardado si la clave existe con el mismo hash; `idempotency_conflict` si el hash cambia); `madridDay(now): string` (YYYY-MM-DD); CLI `grant <usuario> <moneda> <cantidad> --reason <texto>` (auditado en `admin_audit_log`).

- [ ] **Step 1: pgTAP que falla:** tablas, CHECK de saldo, `galaxy_api` no puede UPDATE/DELETE en el libro, RLS activa, FKs a cuentas.
- [ ] **Step 2: Integración que falla:** 20 débitos concurrentes de 100 sobre 1 000 → exactamente 10 pasan y el saldo es 0; repetir una operación devuelve el mismo resultado y no vuelve a cobrar; `madridDay` cambia a las 00:00 de Madrid en invierno y en verano (tests unitarios con `2026-03-29` y `2026-10-25`).
- [ ] **Step 3: Implementar, `supabase migration up`, ver pasar** (`supabase test db` y `vitest --project integration`).
- [ ] **Step 4: Commit** `feat(galaxy): monedero con libro de movimientos e idempotencia`.

### Task 5: Servicio y rutas del gachapón

**Files:** `apps/server/src/gacha/{service.ts,routes.ts}`, `src/app.ts`, `apps/server/tsup.config.ts` (`noExternal` también `@noble/`); test `apps/server/test/integration/gacha.test.ts`.

**Interfaces — Produces:**
- `GET /galaxy/api/gacha` → `GachaView` (la primera visita da la bienvenida: 10 señales con la operación `welcome:<cuenta>`).
- `POST /galaxy/api/gacha/pull` con `Idempotency-Key` → `{ pulls: PulledGalaxy[]; wallet; view }`. En una transacción: bloquea `gacha_state` del grupo, cobra (monedas, señales o la gratis del día de Madrid, solo x1 y banner estándar), y por cada tirada: `pullSeed = randomBytes(8)`, `drawPull`, `generateGalaxy`, inserta galaxia y tirada con versión de configuración y del motor.
- Límite de frecuencia: 30 peticiones de tirada por cuenta y minuto. Interruptor `features.gacha` y modo mantenimiento respetados.

- [ ] **Step 1: Tests que fallan:** bienvenida una sola vez; x1 y x10 cobran lo justo; sin saldo → `402 insufficient_funds` sin cambios; gratis una vez al día y otra al día siguiente de Madrid; la Legendaria llega a la 20 con una suerte forzada (sembrando el estado); banner cerrado → `banner_closed`; misma clave dos veces → mismo resultado; 5 tiradas concurrentes con claves distintas sobre saldo para 3 → 3 pasan; `features.gacha = false` → `503 gacha_disabled`; cada fila de `gacha_pulls` reproduce su galaxia con `generateGalaxy(seed, tier)`.
- [ ] **Step 2: Implementar y ver pasar.** El contenedor arranca con el motor dentro del bundle (smoke de la imagen).
- [ ] **Step 3: Commit** `feat(galaxy): escáner profundo en el servidor`.

### Task 6: Colección, desintegrar y fusionar en el servidor

**Files:** `apps/server/src/collection/{service.ts,routes.ts}`; test `apps/server/test/integration/collection.test.ts`.

**Interfaces — Produces:** `GET /galaxy/api/galaxies?tier&type&palette&finish&sort=new|rarity&cursor&limit≤60` → `{ items: GalaxySummary[]; next?: string; counts: Record<Tier, number> }`; `GET /galaxy/api/galaxies/:id` → `GalaxyDetail` (solo propias); `POST /galaxy/api/galaxies/:id/disintegrate` (idempotente) → `{ dust; wallet }`; `POST /galaxy/api/galaxies/fuse` `{ ids: string[5] }` (idempotente) → `{ galaxy: PulledGalaxy; wallet }` con `origin = 'fusion'`, `lineage = ids`, semilla `deriveSeed(randomSeed, 'fusion')` y acabado nuevo.

- [ ] **Step 1: Tests que fallan:** paginación estable por cursor con 130 galaxias; filtros; ajena → 404; desintegrar dos veces la misma (claves distintas) → la segunda 404; fusionar con repetidas, mezcladas, Legendarias, ajenas o desintegradas → `invalid_fusion` sin cambios; desintegrar y fusionar la misma galaxia a la vez → solo una operación gana; el polvo sale del libro.
- [ ] **Step 2: Implementar y ver pasar.**
- [ ] **Step 3: Commit** `feat(galaxy): colección, desintegración y fusión en el servidor`.

### Task 7: Pantalla de título (centro de navegación)

**Files:** `apps/web/src/hub/*`, `src/api/economy.ts`, `src/App.tsx` (rutas `/`, `/escaner`, `/coleccion`), `src/routes/Inicio.tsx` (se sustituye), `src/scene/GalaxyBackdrop.tsx` (prop `seeds?: string[]`), `src/styles/app.css`, `docs/DESIGN_SYSTEM.md` (§7 nuevos componentes: barra superior, menú, saldo); tests `apps/web/test/hub.test.tsx`, e2e `apps/web/e2e/hub.spec.ts`.

- [ ] **Step 1: ui-ux-pro-max** (navegación de juego, barra de recursos) y leer `titulo-v2.html`; anotar los componentes nuevos en `DESIGN_SYSTEM.md` §7.
- [ ] **Step 2: Tests que fallan:** la barra muestra polvo, monedas y señales con `aria-label` numérico; el Escáner muestra la insignia de tirada gratis cuando toca; los accesos sin construir están deshabilitados con «En desarrollo»; Salir sigue funcionando (e2e); el fondo usa semillas de la colección (prop).
- [ ] **Step 3: Implementar y revisar con capturas** a 1280×720, 1366×650, 1920×1080 y 3440×1440.
- [ ] **Step 4: Commit** `feat(galaxy): pantalla de título con recursos y navegación`.

### Task 8: Cartas de galaxia

**Files:** `apps/web/src/cards/*`, `src/galaxy/cache.ts` (clave con esquema `r1`), `docs/DESIGN_SYSTEM.md` (§7 carta y acabados); tests `apps/web/test/card.test.tsx`, browser `apps/web/test/browser/card.browser.test.ts`.

**Interfaces — Produces:** `useGalaxyImage(seed, columns, size): { canvas?: HTMLCanvasElement; state }` (Worker + caché + un único lienzo WebGL compartido, cola con prioridad a lo visible, `IntersectionObserver`); `<GalaxyCard galaxy size interactive>` con inclinación CSS 3D y brillo según el ratón, marco por nivel y efecto por acabado (holo, prismático, relieve braille, corrupto), nombre, designación, nivel; `<CardBack galaxy>` con la transcripción braille en relieve (48 columnas) y los rasgos.

- [ ] **Step 1: Tests que fallan:** la carta dice nivel, nombre y rareza en texto accesible; con `prefers-reduced-motion` no se inclina; 200 cartas montadas → como mucho 12 trabajos en el Worker a la vez y solo los de cartas visibles; el reverso muestra exactamente el braille de `renderFromSeed(seed, {columns: 48})`.
- [ ] **Step 2: Implementar y ver pasar; capturas de los cinco acabados.**
- [ ] **Step 3: Commit** `feat(galaxy): cartas de galaxia con acabados`.

### Task 9: Pantalla de colección

**Files:** `apps/web/src/collection/*`; tests `apps/web/test/collection.test.tsx`, e2e `apps/web/e2e/collection.spec.ts`.

- [ ] **Step 1: Tests que fallan:** rejilla paginada con filtros y orden; el detalle muestra anverso, reverso y linaje; desintegrar pide confirmación con el polvo que da y actualiza el saldo; fusionar exige 5 del mismo nivel, muestra el coste y revela la nueva con el mismo revelado del Escáner; los errores del servidor se muestran con el texto de `copy/es.ts`.
- [ ] **Step 2: Implementar y ver pasar; capturas.**
- [ ] **Step 3: Commit** `feat(galaxy): colección con desintegración y fusión`.

### Task 10: Escáner profundo y revelado

**Files:** `apps/web/src/scanner/*`, `docs/DESIGN_SYSTEM.md` (§8 bis revelado); tests `apps/web/test/{reveal-sequence,scanner}.test.ts(x)`, e2e `apps/web/e2e/scanner.spec.ts`.

**Interfaces — Produces:** `revealSequence(pulls, opts): Step[]` (pura: estática → barras de señal → escaneo con el color de la rareza → «Fenómeno detectado» → fallo de pantalla en Legendaria; x10 en secuencia y resumen; saltar lleva al resumen); `sfx` (`clack()`, `chord(tier)`, silencio recordado en `localStorage`).

- [ ] **Step 1: ui-ux-pro-max** (revelado, ritmo, accesibilidad sin destellos > 3 por segundo) y diseño del momento orquestado.
- [ ] **Step 2: Tests que fallan:** la secuencia sigue el orden y las duraciones por rareza; saltar va al resumen; con movimiento reducido no hay fallo de pantalla ni sacudidas; las probabilidades y el contador hasta la garantía se ven antes de tirar; e2e: una cuenta nueva recibe la bienvenida, tira x10, ve el resumen y las 10 galaxias aparecen en la colección.
- [ ] **Step 3: Implementar y revisar con capturas** de cada rareza y una secuencia en el tiempo.
- [ ] **Step 4: Commit** `feat(galaxy): escáner profundo con revelado de campo profundo`.

### Task 11: Inspector 3D

**Files:** `apps/web/src/inspector/*` (import dinámico de `three`), `apps/web/package.json`; tests browser `apps/web/test/browser/inspector.browser.test.ts`, e2e (CSP).

- [ ] **Step 1: Tests que fallan:** el chunk de three solo se descarga al abrir el inspector; el lienzo dibuja (píxeles no vacíos) con cada acabado; cerrar libera el contexto WebGL; sin WebGL2 el inspector muestra la carta plana; ninguna violación de CSP.
- [ ] **Step 2: Implementar** (capas en profundidad: fondo, galaxia, marco, brillo; paralaje con el ratón; shader holográfico por acabado; giro para ver el reverso) **y revisar con capturas**.
- [ ] **Step 3: Commit** `feat(galaxy): inspector 3D de las cartas`.

### Task 12: Verificación, revisión final, PR y PRE

- [ ] **Step 1:** `typecheck`, `lint`, `test` (todos los proyectos), `supabase test db`, e2e, `TZ=UTC pnpm test:unit` en la raíz, `docker build` + smoke.
- [ ] **Step 2:** Revisión final de toda la rama con un revisor nuevo; una pasada de arreglos con TDD.
- [ ] **Step 3:** PR a `develop`, CI verde, fusión, despliegue de PRE verificado (título, escáner y colección con una cuenta de prueba creada en PRE por el e2e de humo, o con `grant`) y tiempo de la build del juego medido.
- [ ] **Step 4:** `DEPLOY_PRE.md` (CLI `grant`), memoria y el registro de decisiones junto al plan.
