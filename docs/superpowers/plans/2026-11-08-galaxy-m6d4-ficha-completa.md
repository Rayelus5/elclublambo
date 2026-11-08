# Galaxy Survivor M6d-4 · Ficha completa del jugador

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the edits of GDD §16.2 «Editar todo» that the panel still lacks, from a player's page, each audited with a reason:
- the gacha luck counters (per pity group: since the last legendary, since the last featured, the welcome luck);
- a probe's level and starting-weapon variant;
- unlocking or locking a probe;
- a station room's level;
- a Laboratorio node's level;
- season points, as an adjustment added to what the runs give;
- a galaxy of a chosen type (with the tier, finish and optional seed that exist).

**Architecture:**
- **Migration** `*_galaxy_admin_progress.sql`:
  - `galaxy.probe_grants` (account_id, probe, created_at; PK account+probe): probes unlocked by an admin;
  - `galaxy.season_adjustments` (id, account_id, season text, points int ≠ 0, created_at): points added to a season's General ranking;
  - both only for galaxy_api, RLS on, append-only adjustments.
- **Server** `admin/progress.ts` + routes in `admin/routes.ts`. Each edit:
  - runs `guardTarget`, a transaction and `writeAudit` with before and after;
  - asks the admin's password when it takes something away (a lower level, a negative adjustment, locking a probe), as the wallet already does.
- **Game reads:**
  - the hangar's probe status counts a grant as unlocked (`probeStatus` gains `granted`), and so does the run start;
  - the General ranking adds the season's adjustments (`invalidateLeaderboard` after one);
  - station and Laboratorio edits settle the refinery first, as `upgradeRoom` and `upgradeLabNode` do.
- **Web:**
  - the player's page gets a «Progreso» tab: gacha luck, probes, station, Laboratorio, season, each with its change;
  - «Dar galaxia» gains the type.

**Tech Stack:** Fastify 5, Kysely 0.29, Zod 4, pgTAP, React 19, TanStack Query 5, Vitest, Playwright.

**Spec:** `games/galaxy/docs/GDD.md`:
- §16.2 «Editar todo»: luck counters, unlocked probes, station and modules, Laboratorio nodes, level and experience (done), season score, galaxies with chosen traits, rarity and finish;
- §16.1: every action audited in the same transaction, destructive ones confirm the password;
- §16.2: economy corrections never delete history.

## Global Constraints

- **Admin only** (TOTP); `guardTarget` (no self, no superadmin, staff only by a superadmin); rate limit like the other admin changes.
- **Bounds from the live config:**
  - probe level 1..`probeMaxLevel(probes)`; a variant only if it is one of the probe's weapon's variants open at that level (else 400 `invalid_input`);
  - room level 0..its max (`roomStatus`); a `future` room cannot be edited (409 `room_unavailable`);
  - Laboratorio node level 0..its max (0 removes it); an unknown node is 400;
  - luck counters 0..10 000.
- **Season adjustments:** for the season live now (`season.id`); ±1..1 000 000 points; adjustments are rows, never edited (history stays).
- **A galaxy of a chosen type:** seeds are searched for that `galaxy_type` (at most 4096 tries) at the chosen tier; none found gives 409 `galaxy_type_not_found`. With a seed given, the type must match it (else 409 too).
- **Copy:** Spanish, direct titles, no special symbols in titles, no final period; DESIGN_SYSTEM §8 gets the «Progreso» tab.

## Review Focus

1. **Lowering a room or a node mid-refining** keeps what was already refined at the old rate (settle first), and never leaves the refinery queue above its new capacity.
2. **A probe level lowered below its chosen variant's level** drops the variant to the base weapon, rather than keeping a variant the level no longer opens.
3. **Locking a probe that is the hangar's current probe** moves the hangar back to the account's tested probe, so the next run start does not fail.
4. **A season adjustment after the season changes** counts only in the season it was made in.
5. **Two admins editing the same counter at once** end in one of the two values with two audit rows, never a mix.

---

### Task 1: Migration, server and game reads

**Files:**
- Create: `supabase/migrations/<UTC now>_galaxy_admin_progress.sql`, `supabase/tests/994_galaxy_admin_progress.test.sql`, `games/galaxy/apps/server/src/admin/progress.ts`
- Modify: `packages/shared/src/api/admin.ts` (schemas and `AdminPlayer.progress`), `packages/shared/src/probes/unlocks.ts`, `apps/server/src/runs/hangar.ts`, `apps/server/src/runs/service.ts` (start), `apps/server/src/social/leaderboard.ts`, `apps/server/src/admin/players.ts` (detail, grant with type), `apps/server/src/admin/routes.ts`, `apps/server/src/db/schema.ts`, `packages/shared/src/errors.ts`
- Test: `games/galaxy/apps/server/test/integration/admin-progress.test.ts`, the shared unlocks unit test

**Interfaces:**
- Produces (shared):
  - `adminGachaLuckSchema { group, sinceLegendary, sinceFeatured, welcome, reason, password? }`;
  - `adminProbeSchema { probe, level, variant: string | null, reason, password? }`;
  - `adminProbeGrantSchema { probe, granted: boolean, reason, password? }`;
  - `adminRoomSchema { room, level, reason, password? }`;
  - `adminLabNodeSchema { node, level, reason, password? }`;
  - `adminSeasonSchema { points, reason, password? }`;
  - `adminGalaxyGrantSchema` gains `type?: string`.
  - `AdminPlayer.progress { gacha: { group, sinceLegendary, sinceFeatured, welcome, totalPulls }[]; probes: { probe, level, variant, unlocked, granted }[]; rooms: { room, level, maxLevel, state }[]; lab: { node, level, maxLevel }[]; season: { id, points, adjustments } | null }`.
  - `probeStatus(probe, assigned, stats, cfg, granted?: boolean)`.
- Routes: `POST /galaxy/api/admin/players/:username/{gacha-luck,probe,probe-grant,room,lab-node,season}`.

- [ ] **Step 1: pgTAP** (RED): tables, RLS, grants to galaxy_api only, `points <> 0`, adjustments cannot be updated or deleted.
- [ ] **Step 2: Migration**; `pnpm exec supabase migration up`; pgTAP PASS.
- [ ] **Step 3: Failing tests** (`admin-progress.test.ts`), one per edit with its audit row and the read it changes:
  - `'la suerte del gachapón se fija por grupo y la siguiente tirada la usa'`;
  - `'el nivel de una sonda baja y su variante vuelve al arma base'` (Review Focus 2);
  - `'desbloquear una sonda la deja elegir en el hangar; bloquearla devuelve el hangar a la del test'` (Focus 3);
  - `'bajar la refinería guarda lo refinado y no deja la cola por encima'` (Focus 1);
  - `'un nodo del laboratorio sube y baja, y a 0 desaparece'`;
  - `'un ajuste de temporada suma en la clasificación General de esa temporada y en ninguna otra'` (Focus 4);
  - `'dar una galaxia de un tipo da ese tipo'`, `'quitar pide la contraseña'`, `'no sobre un superadmin ni sobre uno mismo'`.
- [ ] **Step 4: Run** → FAIL.
- [ ] **Step 5: Implement** `admin/progress.ts`, the reads and the routes; `pnpm exec vitest run test/integration/admin-progress.test.ts` → PASS; the hangar, station, lab, social and runs suites stay green; typecheck and lint.
- [ ] **Step 6: Commit** `feat(galaxy): el panel edita la suerte, las sondas, la estación, el laboratorio y la temporada de un jugador`.

### Task 2: Web «Progreso»

**Files:**
- Modify: `apps/web/src/admin/PlayerScreen.tsx` (tab and actions), `apps/web/src/copy/es.ts`, `apps/web/src/styles/app.css`, `games/galaxy/docs/DESIGN_SYSTEM.md`
- Test: `apps/web/test/admin.test.tsx` (or a new `admin-progress.test.tsx`)

- [ ] **Step 1: Consult ui-ux-pro-max** (dense editable settings list, stepper inputs).
- [ ] **Step 2: Failing tests:**
  - the tab lists each part with its values (luck, probes with «Desbloqueada por un admin», rooms with level of max, nodes, season points with adjustments);
  - each change opens its dialog with the right fields;
  - lowering asks the password and raising does not;
  - «Dar galaxia» offers the types.
- [ ] **Step 3: Implement**; web suite green; typecheck and lint; render at 1440 px and look.
- [ ] **Step 4: Commit** `feat(galaxy): pestaña Progreso en la ficha del jugador`.

### Task 3: e2e and PRE docs

- [ ] **Step 1: e2e** `admin-progress.spec.ts`:
  - a new player and a CLI admin;
  - the admin unlocks a probe and raises the Laboratorio's room, then the player sees the probe in the hangar;
  - the admin adds 100 season points;
  - no CSP violations.
- [ ] **Step 2: DEPLOY_PRE step 26** (the migration, what each edit does, what asks the password).
- [ ] **Step 3: Commit** `test(galaxy): e2e de la ficha completa y paso 26 de PRE`.
