# Galaxy Survivor M6d-3 · Reproductor de partidas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the panel's run replayer (GDD §16.2 «partidas, con la opción de reproducirlas», §16.6 «reproductor de partidas»), for admins:
- a list of runs, newest first, filtered by player and by «sospechosas»;
- a run's page that replays it in the arena from its seed, its snapshot and its recorded inputs, with play, pause, speed and a timeline;
- «Comprobar», which replays to the run's last tick and compares the result with what was kept (hash, ticks, kills, depth, level) — the «verificación por repetición» of GDD §21;
- «Marcar como sospechosa» and «Quitar la marca», with a reason and audited (GDD §16.2 «marcar o desmarcar partidas»).

**Architecture:**
- **Sim:** `createReplayer(opts, log, until)` in `packages/sim/src/recording.ts` steps a recorded run one `step()` at a time (moves and picks as the log says); `replay()` becomes a loop over it.
- **Migration:** `*_galaxy_run_marks.sql` lets a finished run change only `suspicious` and `flags` (the finish-once trigger keeps every other column fixed).
- **Server:** `admin/runs.ts` + `admin/runs-routes.ts`:
  - `GET /galaxy/api/admin/runs?page=&player=&suspicious=` → `AdminRunList`;
  - `GET /galaxy/api/admin/runs/:id` → `AdminRunReplay`, with the start options rebuilt from the row (seed, relics, `upgrades` snapshot) and the content of the run's own `content_version`;
  - `POST /galaxy/api/admin/runs/:id/mark` → marks or unmarks, audited, and clears the leaderboard cache.
- **Web:**
  - `/admin/partidas` (list) and `/admin/partidas/:id` (replayer);
  - the arena stage (`createStage`) drawn by a playback driver (`admin/replay/playback.ts`) instead of the keyboard;
  - the HUD and boss bar on top, read-only;
  - the player page's «Partidas» tab links each run to its replay.

**Tech Stack:** packages/sim, Fastify 5, Kysely 0.29, Zod 4, React 19, TanStack Query 5, PixiJS 8, Vitest, pgTAP, Playwright.

**Spec:** `games/galaxy/docs/GDD.md`:
- §16.2: see a player's runs and replay them; mark or unmark runs;
- §16.6: «reproductor de partidas»;
- §14.7, §21: runs are simulated in the client; plausibility now, «verificación por repetición después»;
- §16.1: admins only; every action audited in the same transaction.

## Global Constraints

- **Admin only** (TOTP); moderators and players get 403.
- **Replay = the run's own inputs:**
  - seed, sector, probe, relics and the `upgrades` snapshot (bonuses, variant) from the row;
  - the content of the version the run started with (`content_version`; 0 = the schema defaults);
  - the log from `run_inputs`;
  - played until the run's stored `ticks`.
- **A different `sim_version`** than the browser's `SIM_VERSION` warns before playing: the replay may not match.
- **Marking:**
  - only a finished run;
  - `guardTarget` on its owner (no self, no superadmin, staff only by a superadmin);
  - a reason of 3–300 characters, no password (it can be undone);
  - audited as `run.mark` / `run.unmark` with before and after;
  - rate-limited like the other admin actions.
- **What a mark changes:** what already reads `suspicious` (season ranking and points, sector and probe unlocks, profiles). The experience and pay already credited stay. The dialog says so; corrections go through the wallet and experience tools.
- **Copy:** Spanish, direct titles, no special symbols, no final period.
  - Consult ui-ux-pro-max before the replayer's CSS; DESIGN_SYSTEM §8 gets the replayer.
  - `prefers-reduced-motion`: the stage's reduced option, and the playback does not auto-start.

## Review Focus

1. **A run that never finished** (outcome null, no inputs) shows its row with «Sin terminar» and no replay, never an error.
2. **An abandoned run** replays to its last tick and stops there (the log ends while the world could still run): the replay does not run on past `ticks`.
3. **Seeking backwards** rebuilds from tick 0 and lands on the same state as playing straight there.
4. **A run whose content version is gone** from the config history (or 0) still replays with the defaults, and «Comprobar» says whether it matches.
5. **Marking a run twice**, or unmarking one that is not marked, is a no-op that still answers 200 with the state, and writes no second audit row.

---

### Task 1: Sim replayer and the run-marks migration

**Files:**
- Modify: `games/galaxy/packages/sim/src/recording.ts`, `games/galaxy/packages/sim/src/index.ts`
- Test: `games/galaxy/packages/sim/test/recording.test.ts`
- Create: `supabase/migrations/<UTC now>_galaxy_run_marks.sql`, `supabase/tests/993_galaxy_run_marks.test.sql`

**Interfaces:**
- Produces:
  - `interface Replayer { readonly sim: Sim; next(): boolean }`;
  - `createReplayer(opts: SimOptions, log: InputLog, until: number): Replayer`, where `next()` does one `step()` (a level-up pick from the log, or one world tick with the moves in effect) and returns false once the run is over, the log disagrees at a choice, or `sim.tick >= until` while running.
  - `replay(opts, log, untilTick)` loops `next()` and returns `sim` (behaviour unchanged).

- [ ] **Step 1: Failing tests** in `recording.test.ts`, describe `'el reproductor paso a paso'`:
  - `'paso a paso llega al mismo estado que replay'`: a bot run of 3000 ticks; `createReplayer` stepped until false; `stateHash` equals `stateHash(replay(...))` and `stateHash` of the original sim.
  - `'se para en until aunque el mundo siga'`: `until = 1200` on a 3000-tick log → `sim.tick === 1200`, `next()` keeps returning false.
  - `'cada next es un solo step'`: counting `sim.tick` increments, a pick step leaves `tick` unchanged.
- [ ] **Step 2: Run** `pnpm exec vitest run packages/sim/test/recording.test.ts` → FAIL (`createReplayer` not exported).
- [ ] **Step 3: Implement** `createReplayer` from the body of `replay` (same order: picks first while choosing; moves logged at or before the next tick drive that step); `replay` loops it. Export both from `index.ts`.
- [ ] **Step 4: Run** the sim project → PASS, and the existing recording, quirks and reactions tests stay green.
- [ ] **Step 5: pgTAP** `993_galaxy_run_marks.test.sql` (RED first):
  - a finished run can change `suspicious` and `flags`;
  - changing any other column of a finished run raises `run_finished`;
  - an unfinished run still updates freely.
- [ ] **Step 6: Migration** replaces `galaxy.runs_finish_once()`: when `old.finished_at is not null`, raise `run_finished` unless `to_jsonb(new) - 'suspicious' - 'flags'` is not distinct from the same of `old`. Apply with `pnpm exec supabase migration up`; run `pnpm exec supabase test db` → PASS.
- [ ] **Step 7: Commit** `feat(galaxy): reproductor paso a paso en la simulación y marcas en partidas terminadas`.

### Task 2: Server API

**Files:**
- Create: `games/galaxy/packages/shared/src/api/admin-runs.ts` (export from the shared index), `games/galaxy/apps/server/src/admin/runs.ts`, `games/galaxy/apps/server/src/admin/runs-routes.ts`
- Modify: the admin routes registration, `apps/server/src/social/leaderboard.ts` (`invalidateLeaderboard`)
- Test: `games/galaxy/apps/server/test/integration/admin-runs.test.ts`

**Interfaces:**
- Consumes: `createReplayer`/`replay`, `decodeLog`, `fromBase64`, `stateHash` (Task 1); `guardTarget`, `writeAudit`, `hitRateLimit`, `requireAdmin`.
- Produces (shared):
  - `adminRunsQuerySchema`: `{ page: coerce int ≥1 default 1, player?: string 1–32, suspicious?: 'true' | 'false' }`, strict;
  - `adminRunMarkSchema`: `{ suspicious: boolean, reason: string trimmed 3–300 }`, strict;
  - `AdminRunRow { id, player, startedAt, sector, probe, outcome: 'extracted' | 'died' | 'abandoned' | null, seconds, depth, kills: number | null, suspicious: boolean, flags: string[] }`;
  - `AdminRunList { runs: AdminRunRow[]; total: number; page: number; pages: number }` (50 per page, newest first);
  - `AdminRunReplay { run: AdminRunRow & { finishedAt: string | null; ticks, level, bossKills: number | null; hash: string | null; simVersion: string; contentVersion: number }; start: { seed, sector, probe, relics: RelicInput[], bonuses: StatBonus[], variant: string | null, content: Content }; inputs: string | null }` (base64, null when none).

- [ ] **Step 1: Failing tests** (`admin-runs.test.ts`, deltas on the shared DB):
  - `'un jugador o un moderador reciben 403; una página o un filtro malos dan 400'`;
  - `'la lista va de la más nueva a la más vieja y filtra por jugador y por sospechosas'`;
  - `'una partida jugada con el bot se repite con lo que da la API y llega al hash guardado'`: start a run through the API, play it with `botInput`/`botPick` on `createSim(simOptions)` for ~1200 ticks, finish with the real summary and inputs; `GET /admin/runs/:id`; `replay(start + content, decodeLog(fromBase64(inputs)), run.ticks)` → `stateHash` equals `run.hash`;
  - `'una partida sin terminar sale sin entradas'`;
  - `'marcar y desmarcar queda auditado, y repetirlo no escribe otra fila'`;
  - `'marcar quita la partida de la clasificación de la temporada'` (season points of the run's owner drop by its points);
  - `'no se marca una partida propia, ni de un superadmin, ni una sin terminar'` (403 `self_target`, 403 `staff_target`, 409 `run_open`).
- [ ] **Step 2: Run** `pnpm exec vitest run test/integration/admin-runs.test.ts` (in `apps/server`) → FAIL (404s).
- [ ] **Step 3: Implement**:
  - `listRuns(db, query)`;
  - `runReplay(deps, id)` — content: `parseConfig('content', data)` of the `content` version equal to `content_version`, else `parseConfig('content', {})`; relics from `runs.relics`; bonuses and variant from `runs.upgrades` (missing → `[]` and `null`);
  - `markRun(trx, admin, id, body, ip)` — `for update` on the run, `guardTarget` on its owner, `run_open` if not finished; a no-op when already in that state; marking adds `'admin'` to `flags`, unmarking removes it; `writeAudit`; then `invalidateLeaderboard()`.
  - Routes with `requireAdmin`, the bodies parsed with the shared schemas, the mark rate-limited (`'a:' + id`, `'admin'`, 60, 60).
- [ ] **Step 4: Run** → PASS; typecheck and lint.
- [ ] **Step 5: Commit** `feat(galaxy): API de partidas para el panel con repetición y marcas auditadas`.

### Task 3: Web list and replayer

**Files:**
- Create: `games/galaxy/apps/web/src/api/admin-runs.ts`, `games/galaxy/apps/web/src/admin/RunsScreen.tsx`, `games/galaxy/apps/web/src/admin/ReplayScreen.tsx`, `games/galaxy/apps/web/src/admin/replay/playback.ts`
- Modify: `App.tsx` (routes under `AdminOnly`), `AdminLayout.tsx` (side nav «Partidas»), `PlayerScreen.tsx` (runs rows → «Ver» link), `copy/es.ts` (`copy.admin.runs`), `styles/app.css` (`.replay…`), `docs/DESIGN_SYSTEM.md` §8
- Test: `games/galaxy/apps/web/test/admin-runs.test.tsx`, `games/galaxy/apps/web/test/replay-playback.test.ts`

**Interfaces:**
- Consumes: Task 2's shared types and endpoints; `createReplayer`, `runSummary`, `SIM_VERSION`; `createStage`, `createLoop`, `Hud`, `BossBar`, `clockText`; `ActionDialog`.
- Produces:
  - `createPlayback(opts: SimOptions, log: InputLog, until: number)` → `{ readonly sim, readonly tick, readonly ended, advance(steps: number, onStep?: (events) => void): void, seek(tick: number): void }` — `seek` below the current tick rebuilds from 0, then steps without `onStep`;
  - `checkReplay(sim: Sim, run: AdminRunReplay['run'])` → `{ matches: boolean; rows: { key: 'hash' | 'ticks' | 'kills' | 'depth' | 'level'; saved: string | number | null; replayed: string | number; same: boolean }[] }`.

- [ ] **Step 1: Consult ui-ux-pro-max** (media player transport controls, timeline slider accessibility) and note the choices in DESIGN_SYSTEM §8.
- [ ] **Step 2: Failing tests:**
  - `replay-playback.test.ts`:
    - `'avanzar y volver atrás llegan al mismo estado'`: `seek(900)` after `advance(1500)` has the same `stateHash` as `advance(900)` on a fresh one;
    - `'se para en el último tick'`;
    - `'checkReplay dice qué coincide y qué no'`.
  - `admin-runs.test.tsx`:
    - `'la barra lateral lleva a Partidas'`;
    - `'la lista filtra por sospechosas y por jugador, y cada fila lleva a su repetición'`;
    - `'una partida sin terminar no se reproduce y lo dice'`;
    - `'otra versión de la simulación avisa antes de reproducir'`;
    - `'Comprobar dice si coincide'` (mocked API with a bot-played run: «Coincide con lo guardado»);
    - `'marcar pide un motivo y avisa de que la paga no cambia'`;
    - `'en la ficha del jugador cada partida lleva a su repetición'`.
- [ ] **Step 3: Run** `pnpm exec vitest run --project web test/admin-runs.test.tsx` and the unit project for `replay-playback` → FAIL.
- [ ] **Step 4: Implement**:
  - **RunsScreen:** filters (player name, «Solo sospechosas»), in the URL; DataTable, Pager.
  - **ReplayScreen:**
    - the header with player (link to their page), sector, probe, outcome, time and flags;
    - the stage canvas in a 16:9 frame with the HUD and boss bar on top;
    - the transport: play/pause, speed ×1 ×2 ×4 ×8, a range slider over ticks labelled with `clockText`, «Al principio», «Al final»;
    - keys: Space plays or pauses, ←/→ move 5 s;
    - «Comprobar» seeks to the end (chunked: 3000 steps per frame with a progress note) and shows `checkReplay`'s table;
    - «Marcar como sospechosa» or «Quitar la marca» through `ActionDialog` with the reason field.
  - **PlayerScreen:** the runs tab's action column gets a «Ver» link to `/admin/partidas/:id`.
- [ ] **Step 5: Run** the web and unit projects → PASS; typecheck and lint; build, then render it and look (screenshot at 1440 px and 1920 px).
- [ ] **Step 6: Commit** `feat(galaxy): reproductor de partidas en el panel con comprobación y marcas`.

### Task 4: e2e and PRE docs

**Files:**
- Create: `games/galaxy/apps/web/e2e/admin-replay.spec.ts`
- Modify: `games/galaxy/docs/DEPLOY_PRE.md` (step 25)

- [ ] **Step 1: e2e** `'un admin reproduce la partida de un jugador, la comprueba y la marca'`:
  - a new player (its own context) passes the probe test, launches, moves a few seconds and abandons;
  - a CLI admin (another context) opens Partidas, filters by that player and opens the run;
  - plays it, presses «Comprobar» → «Coincide con lo guardado»;
  - marks it with a reason; the row says «Sospechosa»;
  - no CSP violations.
- [ ] **Step 2: Run** `pnpm exec playwright test e2e/admin-replay.spec.ts` (in `apps/web`) → PASS, then kill :8090.
- [ ] **Step 3: DEPLOY_PRE step 25:**
  - the migration;
  - where the replayer is, what «Comprobar» compares, and what a mark changes (and what it does not).
- [ ] **Step 4: Commit** `test(galaxy): e2e del reproductor y paso 25 de PRE`.
