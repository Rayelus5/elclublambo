# Galaxy M5b-1 · Clanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Los jugadores crean clanes con nombre, etiqueta, emblema y color, se unen a ellos (abiertos o con solicitud), los gestionan con roles, y la clasificación estrena su pestaña de Clanes.

**Architecture:**
- **Tablas:** `galaxy.clans`, `galaxy.clan_members` (una fila por cuenta: una cuenta está en un clan como mucho) y `galaxy.clan_requests`.
- **Las acciones que cobran** (crear un clan cuesta monedas, un sumidero) van por `runOperation` con su clave idempotente. Las demás (unirse, solicitar, aceptar, expulsar, ascender, salir) toman un candado del clan. Así dos entradas a la vez no pasan del máximo y el clan nunca se queda sin líder.
- **La pestaña Clanes** suma la puntuación de temporada de los miembros actuales, con la misma clasificación desde las incursiones de M5a: misma caché y mismas reglas.
- **Configuración viva** (`clans`): máximo de miembros, coste de crear y nivel mínimo para crear.
- **Arte:** ocho emblemas de Aseprite de 32×32, cada uno en seis colores en la misma tira.
- **Más adelante:** el chat del clan llega con M5b-2; las donaciones, con el comercio (M5c); los eventos de clan, con M7.

**Tech Stack:**
- pnpm workspace `games/galaxy`: `@galaxy/shared` (Zod), `@galaxy/server` (Fastify, Kysely y Postgres) y `@galaxy/web` (React 19, RR7 y TanStack Query 5);
- migraciones y pgTAP en `supabase/` de la raíz;
- Playwright;
- Aseprite en modo batch.

**Spec:** `games/galaxy/docs/GDD.md`:
- §14.3: «Qué hacen: chat entre miembros, intercambios, eventos de clan y donar recursos. Límites: máximo de unos 30 miembros…».
- §14.1: «Pestañas: General, Profundidad, Purgas y Clanes».
- §13.1: «Empieza de cero… la clasificación de clanes».

## Global Constraints

- TDD estricto: cada paso de código tiene antes su prueba que falla.
- La simulación no cambia.
- Una cuenta pertenece a un clan como mucho. Un clan nunca pasa de `clans.maxMembers` (30) y siempre tiene un líder mientras tenga miembros.
- Una vista pública de un clan no enseña nada privado de sus miembros: solo nombre, nivel, rol y puntos de temporada.
- Copy en español, títulos directos sin símbolos especiales ni punto final. Cada error nuevo tiene su texto.
- Antes de CSS nuevo se consulta ui-ux-pro-max y se actualiza `DESIGN_SYSTEM.md`. Arte de escaparate en Aseprite. Movimiento quieto con `prefers-reduced-motion`.
- La BD local es del usuario: `migration up` y `test db`, nunca `db reset`. Los e2e solo escriben cuentas `e2e_*`.
- Commits en español, convencionales, con las líneas de coautoría.

## Review Focus

1. **Dos entradas a la vez en un clan con un hueco:** entra una y la otra recibe `409 clan_full`. Lo mismo al aceptar solicitudes → Tarea 3.
2. **El líder se va:**
   - el liderazgo pasa al oficial más antiguo, o si no hay, al miembro más antiguo;
   - si no queda nadie, el clan se disuelve, y su nombre y su etiqueta quedan libres;
   - un líder no puede expulsarse ni degradarse a sí mismo → Tarea 3.
3. **Permisos:**
   - un miembro no expulsa, no acepta y no edita (`403 clan_forbidden`);
   - un oficial no expulsa a otro oficial ni al líder;
   - nadie actúa sobre otro clan → Tarea 3.
4. **Nombres y etiquetas:**
   - únicos sin distinguir mayúsculas;
   - la etiqueta, de 2 a 4 letras o cifras en mayúsculas;
   - crear con nombre ocupado da `409 clan_name_taken` sin cobrar;
   - crear sin fondos da 402 y no crea nada → Tareas 1 y 3.
5. **Ya en un clan:** crear, unirse o solicitar desde otro clan da `409 already_in_clan`. Una solicitud pendiente se cancela al entrar en cualquier clan → Tarea 3.

---

### Task 1: Reglas, configuración y API

**Files:**
- Create: `games/galaxy/packages/shared/src/clans/rules.ts`, `games/galaxy/packages/shared/src/api/clans.ts`, `games/galaxy/packages/shared/test/clans.test.ts`
- Modify: `games/galaxy/packages/shared/src/config/registry.ts`, `games/galaxy/packages/shared/src/errors.ts`, `games/galaxy/packages/shared/src/index.ts`, `games/galaxy/apps/web/src/copy/es.ts` (errores)

**Interfaces:**
- Produces:
  - **clave viva `clans`:** `{ maxMembers: 5–100 (30), createCost: { coins: int (2000) }, minLevel: int 1–99 (5) }`;
  - **constantes:**
    - `CLAN_EMBLEMS = ['shield', 'comet', 'nebula', 'star', 'ring', 'crown', 'eye', 'bolt']`;
    - `CLAN_COLORS = ['solar', 'nova', 'terminal', 'ice', 'uv', 'coral']`;
    - `CLAN_ROLES = ['leader', 'officer', 'member']`;
  - **esquemas:**
    - `clanCreateSchema`: name de 3 a 24 caracteres (letras con tildes y ñ, cifras y espacios sueltos), tag de 2 a 4 `[A-Z0-9]` (se pasa a mayúsculas), description de 0 a 140, emblem, color y open;
    - `clanEditSchema`: lo mismo sin el nombre, todo opcional;
    - `clanTagParamSchema`, `memberActionSchema ({ username })` y `clanSearchSchema ({ q?: 0–24 })`;
  - **reglas puras:**
    - `canManage(actor: ClanRole, target: ClanRole, action: 'kick' | 'promote' | 'demote' | 'accept' | 'edit' | 'transfer'): boolean`;
    - `successor(members: { role; joinedAt }[]): index | null`;
  - **tipos:**
    - `ClanCard { tag, name, emblem, color, open, members, maxMembers, score }`;
    - `ClanView { tag, name, description, emblem, color, open, createdAt, members: ClanMember[], score, rank, requests?: string[], me: { role } | null }`;
    - `ClanMember { username, role, level, points, joinedAt }`;
    - `MyClan = ClanView | null`;
  - `LeaderTab` gana `'clans'`;
  - **errores:** `clan_full`, `clan_name_taken`, `clan_tag_taken`, `already_in_clan`, `not_in_clan`, `clan_not_found`, `clan_forbidden`, `clan_closed`, `request_not_found` y `leader_must_transfer`.

- [ ] **Step 1: pruebas que fallan:**
  - los esquemas aceptan «Los Ñandúes 7» y rechazan dos espacios seguidos, 25 caracteres y la etiqueta «A» o «ABCDE»; la etiqueta «ab1» se convierte en «AB1»;
  - `canManage`:
    - el líder puede con todo menos consigo mismo;
    - un oficial expulsa miembros y acepta, pero no expulsa oficiales ni edita;
    - un miembro no puede con nada;
  - `successor` elige al oficial más antiguo, y si no hay, al miembro más antiguo, y null si no queda nadie;
  - el registro valida los valores por defecto.
- [ ] **Step 2:** `pnpm -C games/galaxy exec vitest run --project unit packages/shared/test/clans.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** PASS; typecheck.
- [ ] **Step 5:** commit `feat(galaxy): reglas, configuración y API de los clanes`.

### Task 2: Migración y pgTAP

**Files:**
- Create: `supabase/migrations/<UTC>_galaxy_clans.sql`, `supabase/tests/982_galaxy_clans.test.sql`
- Modify: `games/galaxy/apps/server/src/db/schema.ts`

**Interfaces:**
- Produces:
  - `galaxy.clans (id uuid pk, name text, tag text, description text, emblem text, color text, open boolean, created_at)`, con índices únicos sobre `lower(name)` y `tag`, y `check`s de forma: la etiqueta `^[A-Z0-9]{2,4}$`, el nombre de 3 a 24 y la descripción ≤ 140;
  - `galaxy.clan_members (account_id uuid pk references accounts on delete cascade, clan_id uuid references clans on delete cascade, role text check in ('leader','officer','member'), joined_at)`, con un índice único parcial «un líder por clan»;
  - `galaxy.clan_requests (clan_id, account_id, created_at, pk (clan_id, account_id))`;
  - permisos solo para `galaxy_api` (select, insert, update y delete en los tres) y RLS.

- [ ] **Step 1:** pgTAP:
  - las tres tablas, los índices únicos (también el nombre sin distinguir mayúsculas) y una cuenta en dos clanes falla;
  - dos líderes fallan;
  - la etiqueta en minúsculas falla;
  - `anon` sin acceso;
  - borrar el clan borra sus miembros y solicitudes.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** la migración; `migration up`; los tipos.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(galaxy): tablas de los clanes, sus miembros y sus solicitudes`.

### Task 3: Servidor

**Files:**
- Create: `games/galaxy/apps/server/src/clans/{service,routes}.ts`, `games/galaxy/apps/server/test/integration/clans.test.ts`
- Modify: `games/galaxy/apps/server/src/social/leaderboard.ts` (pestaña `clans`), `games/galaxy/apps/server/src/social/profiles.ts` (`Profile.clan`), `games/galaxy/apps/server/src/app.ts`

**Interfaces:**
- Consumes: Task 1 y Task 2.
- Produces:
  - **rutas de los clanes:**
    - `GET /galaxy/api/clans?q=` → `ClanCard[]` (hasta 30, por puntuación);
    - `GET /galaxy/api/clans/mine` → `MyClan`;
    - `GET /galaxy/api/clans/:tag` → `ClanView`, con `requests` solo para líder y oficiales;
    - `POST /galaxy/api/clans` (idempotente; cobra `createCost`, nivel ≥ `minLevel` o `403 level_too_low`) → `ClanView`;
    - `PATCH /galaxy/api/clans/:tag` (líder) → `ClanView`;
  - **rutas de los miembros:**
    - `POST /galaxy/api/clans/:tag/join`: abierto, entra; cerrado, `409 clan_closed`;
    - `POST /galaxy/api/clans/:tag/request`: cerrado, deja solicitud; abierto, entra;
    - `DELETE /galaxy/api/clans/:tag/request`;
    - `POST /galaxy/api/clans/:tag/requests/:username/accept|reject`;
    - `POST /galaxy/api/clans/:tag/members/:username/kick|promote|demote|transfer`;
    - `POST /galaxy/api/clans/:tag/leave`;
  - **la pestaña `clans`** de `/leaderboard`: filas `{ rank, tag, name, value }`, con `me` el clan propio;
  - `Profile.clan: { tag, name, emblem, color } | null`.
  - Error nuevo `level_too_low`.

- [ ] **Step 1:** integración que falla, una prueba por cada punto de la Review Focus, más:
  - crear cobra el coste y deja al creador de líder;
  - la vista pública trae las claves exactas;
  - buscar por nombre o etiqueta;
  - la pestaña de clanes suma los puntos de temporada de los miembros (con una temporada propia vía `fixedConfig`, como en M5a);
  - el perfil dice su clan.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** PASS; toda la integración en verde.
- [ ] **Step 5:** commit `feat(galaxy): crear, unirse y gestionar clanes, y su clasificación`.

### Task 4: Arte en Aseprite

**Files:**
- Create: `games/galaxy/art/clans/paint-emblems.lua`, `games/galaxy/art/clans/*.aseprite`, `games/galaxy/apps/web/src/clans/emblems/{shield,comet,nebula,star,ring,crown,eye,bolt}.png`, `games/galaxy/apps/web/src/clans/emblems.ts`, `games/galaxy/apps/web/test/clan-art.test.ts`

**Interfaces:**
- Produces:
  - ocho tiras de 192×32: el mismo emblema en los seis colores, en el orden de `CLAN_COLORS`. Cada uno es un escudo de fondo con su figura, sombreado y con contorno;
  - `clanEmblemUrl(emblem)`;
  - `clanEmblemOffset(color)`.

- [ ] **Step 1:** prueba que falla:
  - ocho PNG de 192×32, uno por emblema, sin que sobre ninguno;
  - los seis colores de cada uno son distintos entre sí.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** pintar y revisar la hoja de contacto a ×6.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(galaxy): emblemas de los clanes pintados en Aseprite`.

### Task 5: Web

**Files:**
- Create: `games/galaxy/apps/web/src/clans/{ClansScreen,ClanScreen,CreateClanDialog,ClanEmblem}.tsx`, `games/galaxy/apps/web/src/api/clans.ts`, `games/galaxy/apps/web/test/clans.test.tsx`
- Modify:
  - `games/galaxy/apps/web/src/App.tsx`: `/clanes` y `/clanes/:tag`;
  - `games/galaxy/apps/web/src/hub/MainMenu.tsx`: el mosaico Clan lleva a tu clan o a `/clanes`;
  - `games/galaxy/apps/web/src/social/{LeaderboardScreen,ProfileScreen}.tsx`: la pestaña Clanes activa y el clan en el perfil;
  - `games/galaxy/apps/web/src/copy/es.ts`;
  - `games/galaxy/apps/web/src/styles/app.css`;
  - `games/galaxy/docs/DESIGN_SYSTEM.md` (§8 duodecies).

- [ ] **Step 1:** pruebas que fallan:
  - **la lista de clanes:**
    - cada clan muestra emblema, nombre, etiqueta, miembros y puntos;
    - «Unirse», o «Solicitar» si es cerrado;
    - la búsqueda filtra;
    - «Crear clan» abre el diálogo con el coste, y está desactivado con su razón si no llegas al nivel o a las monedas;
  - **el diálogo de crear:**
    - el nombre, la etiqueta y la descripción con su contador;
    - el emblema y el color, elegidos en una rejilla de radios con nombre;
    - enviar crea y lleva a la página del clan;
  - **la página del clan:**
    - los miembros con rol, nivel y puntos, enlazados a su perfil;
    - para el líder: ascender, degradar, expulsar (con confirmación), transferir, las solicitudes con aceptar y rechazar, y editar;
    - para el oficial, solo lo suyo;
    - «Salir del clan» confirma; el líder solo, que lo disuelve, ve otra confirmación;
  - **en la clasificación:** la pestaña Clanes enseña clanes con su emblema y enlace;
  - **en el perfil:** el clan con su emblema.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar. Consultar ui-ux-pro-max antes del CSS; añadir §8 duodecies.
- [ ] **Step 4:** PASS; web, typecheck y lint; capturas a 1280, 1600 y 1920 revisadas.
- [ ] **Step 5:** commit `feat(galaxy): pantallas de los clanes y su pestaña en la clasificación`.

### Task 6: e2e, documentación, verificación, revisión final, PR y PRE

- [ ] **e2e** (`clans.spec.ts`):
  - una cuenta nueva sube a nivel 5 (experiencia insertada en sus propias filas, como los e2e de M4c-1) y recibe monedas por la CLI;
  - crea un clan cerrado;
  - una segunda cuenta solicita entrar, la primera la acepta y la asciende a oficial;
  - la segunda sale;
  - la primera ve la pestaña Clanes;
  - sin violaciones de CSP.
- [ ] **DEPLOY_PRE paso 15.**
- [ ] **Verificación completa, revisión (opus), una pasada de correcciones, PR, CI, fusión, PRE, registro y memoria.**
