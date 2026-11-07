# Galaxy M5a · Perfiles, nivel de cuenta y clasificación Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada cuenta tiene nivel y experiencia, cada incursión suma puntos de temporada, la clasificación de la temporada enseña a todos con sus pestañas, y cualquiera puede ver el perfil y la colección de otro jugador.

**Architecture:**
- **El nivel de cuenta** es experiencia guardada en `galaxy.account_xp`, que se cobra al terminar cada incursión no sospechosa en la misma transacción que el pago. La experiencia nunca se recorta por el rendimiento diario. Los umbrales de nivel son configuración viva (`account`).
- **La temporada** es configuración viva (`season`): id, nombre, fechas y puntos por capa, Núcleo y extracción, más los tramos.
  - La puntuación se calcula desde `galaxy.runs` (terminadas, no sospechosas, dentro de las fechas), así que cambiar los puntos o las fechas la recalcula sin migrar nada.
  - La clasificación completa se guarda en memoria 30 s por temporada y pestaña.
- **Los perfiles** son públicos para cualquiera con sesión: nivel, temporada, récords, recuento de la colección y el planetario. Nada de saldo, equipo ni sonda. La colección pública reutiliza la paginación de la colección con `PublicGalaxy`.
- **La web:**
  - `/clasificacion`, con el podio y las pestañas General, Profundidad y Purgas; la de Clanes queda desactivada hasta M5b;
  - la columna derecha del inicio pasa a ser la temporada (GDD §4), en lugar del resumen de la colección;
  - `/perfil/:username` y `/perfil/:username/coleccion`;
  - el nivel junto al avatar de la barra superior;
  - la experiencia y los puntos en los resultados.
- **El arte:** los cinco emblemas de los tramos (Bronce, Plata, Oro, Platino y Estelar) se pintan en Aseprite.

**Tech Stack:**
- pnpm workspace `games/galaxy`: `@galaxy/shared` (Zod), `@galaxy/server` (Fastify, Kysely y Postgres) y `@galaxy/web` (React 19, RR7 y TanStack Query 5);
- migraciones y pgTAP en `supabase/` de la raíz;
- Playwright;
- Aseprite en modo batch.

**Spec:** `games/galaxy/docs/GDD.md`:
- §12.1: «Nivel de cuenta: se sube con experiencia de incursiones y misiones, y desbloquea funciones como el comercio y el chat. Perfil: avatar, título, marco, galaxias destacadas e historial de temporadas».
- §14.1: «Principal: puntuación general de la temporada… Qué suma: profundidad, Núcleos purgados, extracciones, misiones, logros y entradas nuevas del catálogo. Comerciar y donar no suman. Pestañas: General, Profundidad, Purgas y Clanes».
- §14.2: «Cualquiera puede ver tu perfil y tu colección. Desde ahí se puede visitar tu estación».
- §13.1: tramos Bronce, Plata, Oro, Platino y Estelar; «las partidas marcadas como sospechosas no suman».
- §4: «Columna derecha: clasificación de la temporada con pestañas, podio, tu fila, tramos de premios y Ver clasificación completa».
- §11.3 bis: la experiencia y la puntuación de temporada nunca se recortan.

Misiones, logros, catálogo, títulos, marcos y avatares elegibles llegan con M7. Clanes y su pestaña, con M5b. Los premios de cierre de temporada, con M7.

## Global Constraints

- TDD estricto: cada paso de código tiene antes su prueba que falla.
- La simulación no cambia (`SIM_VERSION` 1.5.0).
- Las partidas sospechosas no dan experiencia ni puntos.
- Un perfil o una clasificación no enseñan nada privado: ni saldo, ni equipo, ni sonda, ni sesión.
- Copy en español, títulos directos sin símbolos especiales ni punto final. Cada error nuevo tiene su texto.
- Antes de CSS nuevo se consulta ui-ux-pro-max y se actualiza `DESIGN_SYSTEM.md`. Arte de escaparate en Aseprite. Movimiento quieto con `prefers-reduced-motion`.
- La BD local es del usuario: `migration up` y `test db`, nunca `db reset`. Los e2e solo escriben cuentas `e2e_*`.
- Commits en español, convencionales, con las líneas de coautoría.

## Review Focus

1. **Una incursión sospechosa o abandonada:**
   - la sospechosa no da experiencia ni puntos;
   - la abandonada sí da la experiencia de su tiempo y sus capas, pero no la extracción;
   - los resultados dicen lo que ha dado → Tareas 1 y 3.
2. **Fuera de las fechas de la temporada:** una incursión terminada antes de `startsAt` o desde `endsAt` no suma. Si no hay temporada abierta, la clasificación lo dice y el inicio también → Tareas 3 y 5.
3. **Empates y la fila propia:**
   - los empates van por quién llegó antes (la última incursión que puntuó, más antigua primero) y luego por nombre;
   - la fila propia sale aunque estés fuera del top 100;
   - sin puntos no hay fila → Tarea 3.
4. **Un perfil o una colección pública de un nombre que no existe** da `404 profile_not_found`. La respuesta no trae nada privado (sus claves exactas) → Tarea 3.
5. **Subir de nivel con una sola incursión que salta varios umbrales:** el nivel es el del total, `levelUp` es verdadero y el nivel máximo se queda en el último umbral → Tareas 1 y 3.

---

### Task 1: Reglas, configuración y API

**Files:**
- Create: `games/galaxy/packages/shared/src/progress/account.ts`, `games/galaxy/packages/shared/src/progress/season.ts`, `games/galaxy/packages/shared/src/api/social.ts`, `games/galaxy/packages/shared/test/progress.test.ts`
- Modify: `games/galaxy/packages/shared/src/config/registry.ts`, `games/galaxy/packages/shared/src/errors.ts`, `games/galaxy/packages/shared/src/index.ts`, `games/galaxy/packages/shared/src/api/runs.ts` (`RunResult.progress`), `games/galaxy/packages/shared/src/account.ts` (`MeResponse.level`), `games/galaxy/apps/web/src/copy/es.ts` (errores)

**Interfaces:**
- Produces:
  - **clave viva `account`:**
    - `xp: { perMinute: 10, perLayer: 15, perCore: 40, extraction: 30 }` (enteros 0–10 000);
    - `levels`: la experiencia acumulada para llegar a cada nivel desde el 2, creciente, de 1 a 99 entradas. Por defecto 29 entradas: `[100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500]` y luego +1000 cada una hasta 24 500, el nivel 30;
  - **clave viva `season`:**
    - `{ id: 'season-1', name: 'Temporada 1', startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-12-13T00:00:00.000Z' }`, con `startsAt < endsAt`;
    - `points: { layer: 10, core: 50, extraction: 25 }`;
    - `tiers: [500, 2000, 6000, 15000, 30000]`, crecientes, que son Bronce, Plata, Oro, Platino y Estelar;
    - `top: 100` (de 3 a 500): cuántas filas enseña la clasificación;
    - los valores de cada pestaña: General es la puntuación, Profundidad la capa más honda de la temporada y Purgas los Núcleos de la temporada;
  - **funciones:**
    - `runXp(run: { seconds: number; depth: number; bossKills: number; outcome: RunOutcome }, cfg): number`, que redondea abajo los minutos por `perMinute`;
    - `levelOf(xp, cfg): { level: number; into: number; next: number | null }`;
    - `seasonPoints(run, cfg): number`;
    - `seasonTier(score, cfg): SeasonTier | null`, con `SEASON_TIERS = ['bronze', 'silver', 'gold', 'platinum', 'stellar']`;
    - `seasonOpen(cfg, now): boolean`;
  - **tipos:**
    - `LeaderTab = 'general' | 'depth' | 'purges'`;
    - `LeaderRow { rank, username, level, value }`;
    - `Leaderboard { season: SeasonInfo | null, tab, rows: LeaderRow[], me: LeaderRow | null, total }`, donde `SeasonInfo { id, name, startsAt, endsAt, tiers }`;
    - `Profile { username, since, level, season: { score, rank, tier, maxDepth, purges, extractions } | null, records: { maxDepth, purges, runs }, collection: { total, counts }, planetarium: { prestige, exhibits, cover: PublicGalaxy | null } }`;
    - `PublicCollectionPage { items: PublicGalaxy[]; next?: string; counts }`;
  - `RunResult.progress: { xp: number; level: number; levelUp: boolean; points: number }`;
  - `MeResponse.level: number`;
  - esquemas `leaderboardQuerySchema` y `publicCollectionQuerySchema`;
  - errores `profile_not_found` y `season_closed`. Este último no se lanza: lo usa la web para «No hay ninguna temporada abierta».

- [ ] **Step 1: pruebas que fallan** en `progress.test.ts`:
  - `runXp` de 10 min, capa 2, 1 Núcleo y extraída = 100 + 30 + 40 + 30 = 200;
  - la misma abandonada = 170; 59 s = 0 de tiempo;
  - `levelOf(0)` = nivel 1, `into` 0 y `next` 100;
  - `levelOf(1000)` = nivel 5;
  - `levelOf(99999)` = nivel 30 con `next` null;
  - saltar varios umbrales;
  - `seasonPoints` = 2×10 + 50 + 25 = 95;
  - `seasonTier(499)` = null, `seasonTier(500)` = 'bronze' y `seasonTier(30000)` = 'stellar';
  - `seasonOpen` en el borde: `startsAt` incluido y `endsAt` excluido;
  - el registro rechaza `levels` no crecientes y `endsAt <= startsAt`.
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project unit packages/shared/test/progress.test.ts` → FAIL.
- [ ] **Step 3:** implementar. Los textos de los errores van en `copy.errors`.
- [ ] **Step 4:** la misma orden → PASS; `pnpm -C games/galaxy typecheck`.
- [ ] **Step 5:** commit `feat(galaxy): nivel de cuenta, puntos de temporada y API social`.

### Task 2: Migración y pgTAP

**Files:**
- Create: `supabase/migrations/<UTC>_galaxy_progress.sql`, `supabase/tests/981_galaxy_progress.test.sql`
- Modify: `games/galaxy/apps/server/src/db/schema.ts`

**Interfaces:**
- Produces:
  - `galaxy.account_xp (account_id uuid primary key references galaxy.accounts on delete cascade, xp bigint not null default 0 check (xp >= 0), updated_at timestamptz not null default now())`;
  - un índice `runs_season (finished_at) where finished_at is not null and not suspicious` para la clasificación;
  - permisos solo para `galaxy_api` (select, insert, update; nunca delete) y RLS.
  - La migración rellena `account_xp` con la experiencia de las incursiones ya terminadas y no sospechosas, con la fórmula por defecto (10 por minuto entero, 15 por capa, 40 por Núcleo y 30 por extracción).

- [ ] **Step 1:** pgTAP:
  - la tabla, su clave primaria, el `check` de xp ≥ 0 y el índice;
  - `galaxy_api` sin delete y `anon` sin acceso;
  - el relleno: una cuenta con dos incursiones terminadas, una sospechosa, tiene la experiencia de la otra. Se comprueba con la fórmula aplicada a filas insertadas en la prueba y calculada por la vista o función que la migración deja: `galaxy.run_xp(seconds, depth, boss_kills, outcome)`.
- [ ] **Step 2:** `pnpm exec supabase test db` → FAIL.
- [ ] **Step 3:** la migración; `pnpm exec supabase migration up`; los tipos en `schema.ts`.
- [ ] **Step 4:** `pnpm exec supabase test db` → PASS.
- [ ] **Step 5:** commit `feat(galaxy): experiencia de cuenta guardada y su relleno`.

### Task 3: Servidor

**Files:**
- Create: `games/galaxy/apps/server/src/social/{leaderboard,profiles,routes}.ts`, `games/galaxy/apps/server/test/integration/social.test.ts`
- Modify: `games/galaxy/apps/server/src/runs/service.ts` (experiencia y `progress`), `games/galaxy/apps/server/src/runs/routes.ts` (leer `account` y `season` antes de la transacción), `games/galaxy/apps/server/src/auth/routes.ts` (`level` en `/auth/me`), `games/galaxy/apps/server/src/app.ts`

**Interfaces:**
- Consumes: Task 1 (reglas y tipos) y Task 2 (tabla).
- Produces:
  - **al terminar una incursión no sospechosa:**
    - `finishRun` suma `runXp` a `account_xp` (`insert … on conflict do update`, en la misma transacción);
    - devuelve `progress` con la experiencia ganada, el nivel nuevo, `levelUp` y los puntos de temporada. Los puntos son 0 si no hay temporada abierta o es sospechosa;
  - `GET /galaxy/api/leaderboard?tab=` → `Leaderboard`:
    - top 100 con rango de competición (empates comparten rango), ordenados por valor desc, luego por la última incursión que puntuó asc y luego por nombre;
    - `me` sale aunque esté fuera del top;
    - caché de 30 s por temporada y pestaña, con `invalidateLeaderboard()` para las pruebas;
    - sin cuentas suspendidas;
  - `GET /galaxy/api/profiles/:username` → `Profile`, o `404 profile_not_found`;
  - `GET /galaxy/api/profiles/:username/galaxies?sort&cursor&tier` → `PublicCollectionPage`, con el mismo cursor que la colección. Va limitado por cuenta (120/min).

- [ ] **Step 1:** integración que falla:
  - **experiencia:**
    - una incursión terminada da experiencia y `progress`, y una sospechosa no (se fuerza con un `claim` imposible, como en `runs.test.ts`);
    - `/auth/me` trae el nivel;
  - **clasificación:**
    - tres cuentas con incursiones insertadas dentro de la temporada, una fuera y otra sospechosa;
    - las tres pestañas, con sus valores y su orden;
    - un empate comparte rango;
    - `me` fuera del top 100 (con `limit` de prueba vía `fixedConfig`), y sin puntos `me` es null;
    - sin temporada abierta (`season` con fechas pasadas), `season` es null y no hay filas;
  - **perfil:**
    - claves exactas;
    - la temporada con rango y tramo;
    - los récords de siempre;
    - el recuento de la colección;
    - el planetario con su portada;
    - 404 con un nombre que no existe;
  - **colección pública:** solo `PublicGalaxy` (claves exactas), paginada por rareza, filtrada por tramo, sin las desintegradas, y 404.
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project integration apps/server/test/integration/social.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** la misma orden → PASS; toda la integración en verde.
- [ ] **Step 5:** commit `feat(galaxy): experiencia al terminar, clasificación de temporada y perfiles públicos`.

### Task 4: Arte en Aseprite

**Files:**
- Create: `games/galaxy/art/seasons/paint-tiers.lua`, `games/galaxy/art/seasons/tiers.aseprite`, `games/galaxy/apps/web/src/social/tiers/{bronze,silver,gold,platinum,stellar}.png`, `games/galaxy/apps/web/src/social/tiers.ts`, `games/galaxy/apps/web/test/tier-art.test.ts`

**Interfaces:**
- Produces:
  - **los emblemas:** cinco tiras de 4 fotogramas de 32×32. Cada uno es una insignia con forma propia y más rica cuanto más alto el tramo:
    - Bronce, un escudo;
    - Plata, un escudo con alas;
    - Oro, una estrella de cinco puntas;
    - Platino, un cristal tallado;
    - Estelar, una galaxia espiral con corona.
    - Todos llevan un brillo que recorre el borde en bucle;
  - `tierArtUrl(tier: SeasonTier): string | undefined`.

- [ ] **Step 1:** prueba que falla: cinco PNG de 128×32, un `tierArtUrl` por tramo, cada fotograma distinto del anterior y no sobra ninguno.
- [ ] **Step 2:** la prueba → FAIL.
- [ ] **Step 3:** pintar con el script en modo batch y revisar la hoja de contacto a ×6.
- [ ] **Step 4:** la prueba → PASS.
- [ ] **Step 5:** commit `feat(galaxy): emblemas de los tramos de temporada pintados en Aseprite`.

### Task 5: Web

**Files:**
- Create:
  - `games/galaxy/apps/web/src/social/{LeaderboardScreen,ProfileScreen,PublicCollectionScreen,SeasonSummary,TierBadge}.tsx`;
  - `games/galaxy/apps/web/src/api/social.ts`;
  - `games/galaxy/apps/web/test/{leaderboard,profile}.test.tsx`.
- Modify:
  - `games/galaxy/apps/web/src/App.tsx`;
  - `games/galaxy/apps/web/src/hub/{TitleScreen,MainMenu,TopBar}.tsx`: la columna derecha, el mosaico «Ranking» que lleva a `/clasificacion` y el nivel y enlace al perfil;
  - `games/galaxy/apps/web/src/hangar/ResultsScreen.tsx`: la experiencia, el nivel y los puntos;
  - `games/galaxy/apps/web/src/planetarium/VisitScreen.tsx`: enlace a su perfil;
  - `games/galaxy/apps/web/src/copy/es.ts`;
  - `games/galaxy/apps/web/src/styles/app.css`;
  - `games/galaxy/docs/DESIGN_SYSTEM.md`.

**Interfaces:**
- Consumes: Task 3 (rutas y tipos) y Task 4 (`tierArtUrl`).
- Produces:
  - los hooks `useLeaderboard(tab)`, `useProfile(username)` y `usePublicCollection(username, q)`;
  - las rutas `/clasificacion`, `/perfil/:username` y `/perfil/:username/coleccion`.

- [ ] **Step 1:** pruebas que fallan:
  - **clasificación:**
    - las pestañas son `role="tablist"`, con General, Profundidad y Purgas, y Clanes desactivada con «Llega con los clanes»;
    - el podio con los tres primeros, enlazados a su perfil;
    - la tabla con rango, jugador, nivel y valor;
    - tu fila resaltada, y fijada abajo si estás fuera del top;
    - la temporada con su nombre, los días que quedan y los tramos con su emblema, marcando el tuyo;
    - sin temporada, «No hay ninguna temporada abierta»;
  - **inicio:**
    - la columna derecha enseña la temporada (los tres primeros, tu fila y «Ver clasificación completa»);
    - el mosaico «Ranking» lleva a `/clasificacion`;
    - el avatar lleva a tu perfil y dice tu nivel;
  - **perfil:**
    - el nombre, el nivel y «Miembro desde…»;
    - la temporada con su tramo;
    - los récords;
    - la colección por rareza con «Ver su colección»;
    - el planetario con «Visitar su planetario»;
    - un 404 dice «No hay ningún jugador con ese nombre»;
  - **colección pública:** sus cartas sin acciones, «Cargar más» y filtro por rareza;
  - **resultados:** «+200 de experiencia», «Nivel 6» con «Subes de nivel», y «+95 puntos de temporada».
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project web apps/web/test/leaderboard.test.tsx apps/web/test/profile.test.tsx` → FAIL.
- [ ] **Step 3:** implementar. Consultar ui-ux-pro-max (tablas de clasificación, pestañas y perfiles) antes del CSS; añadir §8 undecies en `DESIGN_SYSTEM.md`.
- [ ] **Step 4:** la misma orden → PASS; web, typecheck y lint en verde; capturas a 1280, 1600 y 1920 revisadas.
- [ ] **Step 5:** commit `feat(galaxy): clasificación de temporada, perfiles y colección pública`.

### Task 6: e2e, documentación, verificación, revisión final, PR y PRE

- [ ] **e2e** (`social.spec.ts`):
  - una cuenta nueva con cinco incursiones insertadas en sus filas, como en `relics.spec.ts`;
  - sale en la clasificación con su fila resaltada;
  - otra cuenta abre su perfil desde la clasificación, ve su nivel y su temporada, entra en «Ver su colección» y en «Visitar su planetario»;
  - sin violaciones de CSP.
- [ ] **DEPLOY_PRE paso 14:** la migración y su relleno, las claves `account` y `season`, y qué comprobar.
- [ ] **Verificación completa:**
  - typecheck y lint;
  - `pnpm -C games/galaxy test`;
  - `GALAXY_CALIBRATE=1`;
  - pgTAP;
  - `TZ=UTC pnpm test:unit` en la raíz;
  - todo el e2e;
  - Docker y humo.
- [ ] **Cierre:**
  - revisor nuevo (opus) y una pasada de correcciones con TDD;
  - PR a `develop`, CI y fusión;
  - comprobación en PRE (si Cloudflare está bloqueado por el fútbol, esperar y reintentar);
  - registro a docs y memoria.
