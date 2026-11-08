# Galaxy Survivor M6d-5 · Multiplicadores globales y simulador de economía

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the last two pieces of GDD §16:
- **§16.3, temporary global multipliers** (e.g. «doble polvo el fin de semana"): a new live config key `boosts`, edited from the existing config panel and applied to the pay of runs that finish inside its window. Players see the boosts running now.
- **§16.6, the economy simulator** that works on the config being edited, before publishing it. In the panel's editor for `runs` (and `boosts`), sample runs played by the simulation's bot compare what runs pay under the live config and the draft: per run, and per day of play with the daily yield.

**Architecture:**
- **Shared:**
  - `boosts` in the config registry: a list of `{ id, name, currency: 'coins' | 'dust' | 'material' | 'signal', factor 1–5, startsAt, endsAt }`, at most 10, ids unique, end after start;
  - `activeBoosts(cfg, now)` and `boostFactor(cfg, currency, now)` (factors of overlapping boosts multiply, capped at 5);
  - `economy/simulate.ts`: `simulateEconomy(samples, runsCfg, boostsCfg, opts)` turns bot-played run summaries into pay per run and per day.
- **Server:**
  - `finishRun` multiplies coins, dust and material by the boost factor of the finish time and the boss signal chance by the signal factor, before the per-run caps;
  - the applied boosts go into `payout.boosts` and the result's `breakdown.boosts`;
  - `GET /galaxy/api/boosts` answers the boosts running now, for signed-in players.
- **Web:**
  - the hub's top bar and the hangar show the boosts running now («Polvo x2 hasta el domingo»);
  - the run results list a boost that paid;
  - in `/admin/configuracion/runs` and `/admin/configuracion/boosts`, a «Simulador de la economía» under the editor, like the gacha one.

**Tech Stack:** Zod 4, packages/sim (bot), Fastify 5, React 19, TanStack Query 5, Vitest, Playwright.

**Spec:** `games/galaxy/docs/GDD.md`:
- §16.3: «Multiplicadores globales temporales, por ejemplo doble polvo el fin de semana»; every parameter in versioned config, validated with the shared Zod schemas;
- §16.6: «simulador del gachapón y de la economía con la configuración en edición, antes de publicarla»;
- §11.3 bis: the per-run caps and the daily yield still apply on top.

## Global Constraints

- **Tests never publish live config to the local DB:** boosts are tested with `fixedConfig`, and the config admin flow with the existing rolled-back transaction.
- **Boost bounds:**
  - factor 1–5, with the product of overlapping boosts on one currency capped at 5;
  - windows of up to 14 days;
  - the per-run caps (`runs.caps.runCoins/runDust/runMaterial`) still bound the pay.
- **Snapshot at the finish:** a run is boosted by what runs when it finishes. The applied boosts are kept in its payout.
- **The simulator only reads:**
  - it plays the bot in the browser in slices, so the page stays responsive;
  - its numbers are bot numbers, labelled as an estimate;
  - nothing is sent to the server.
- **Copy:** Spanish, direct titles, no special symbols in titles, no final period. Consult the dataviz skill before the simulator's figures; DESIGN_SYSTEM §8 gets the boost chip and the simulator.

## Review Focus

1. **A boost that ended a second before the finish** does not pay; one that started a second before does.
2. **Two boosts on the same currency** multiply, never past 5.
3. **A boosted run that hits the per-run cap** pays the cap and says it was capped.
4. **A draft that does not validate** shows its issues and no simulation, never a crash.
5. **The simulator on a slow machine** keeps the page responsive and can be stopped.

---

### Task 1: Shared boosts and the server

**Files:**
- Modify: `packages/shared/src/config/registry.ts` (`boosts`), `packages/shared/src/runs/rewards.ts` (or a new `packages/shared/src/economy/boosts.ts`), `packages/shared/src/api/runs.ts` (`breakdown.boosts`), `apps/server/src/runs/service.ts`, `apps/server/src/runs/routes.ts` (`GET /galaxy/api/boosts`)
- Test: `packages/shared/test/boosts.test.ts`, `apps/server/test/integration/boosts.test.ts`

- [ ] **Step 1: Failing tests:**
  - shared:
    - `'un multiplicador cuenta dentro de su ventana y no fuera'` (Focus 1);
    - `'dos multiplicadores de la misma moneda se multiplican hasta 5'` (Focus 2);
    - `'la configuración rechaza factores fuera de 1 a 5, ventanas al revés o de más de 14 días e ids repetidos'`;
  - integration (`fixedConfig({ boosts: [...] })`):
    - `'una partida que termina con doble polvo cobra el doble de polvo y lo dice'`;
    - `'con el tope de la partida, cobra el tope'` (Focus 3);
    - `'GET /boosts da los que corren ahora'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**: the schema; `activeBoosts`/`boostFactor`; `finishRun` applies them (coins, dust and material before the caps, signals on the chance) and records them; the route.
- [ ] **Step 4: Run** → PASS; the runs, station and config suites stay green; typecheck and lint.
- [ ] **Step 5: Commit** `feat(galaxy): multiplicadores globales temporales en la configuración viva`.

### Task 2: Players see the boosts

**Files:**
- Create: `apps/web/src/hub/Boosts.tsx` (chip), `apps/web/src/api/boosts.ts`
- Modify: the hub top bar, `HangarScreen`, the run results, `copy/es.ts`, `styles/app.css`
- Test: `apps/web/test/boosts.test.tsx`

- [ ] **Step 1: Consult ui-ux-pro-max** (status chip, time remaining).
- [ ] **Step 2: Failing tests:**
  - the chip names each boost with its factor and its end («Polvo x2 hasta el domingo 23:59»);
  - without boosts, nothing shows;
  - the results list «Multiplicador: Doble polvo x2» when one paid.
- [ ] **Step 3: Implement**; web suite green; render and look.
- [ ] **Step 4: Commit** `feat(galaxy): los jugadores ven los multiplicadores en marcha`.

### Task 3: The economy simulator

**Files:**
- Create: `packages/shared/src/economy/simulate.ts`, `apps/web/src/admin/EconomySimulator.tsx`
- Modify: `apps/web/src/admin/ConfigScreen.tsx` (under the `runs` and `boosts` editors), `copy/es.ts`, `styles/app.css`, `games/galaxy/docs/DESIGN_SYSTEM.md`
- Test: `packages/shared/test/economy.test.ts`, `apps/web/test/admin-economy.test.tsx`

**Interfaces:**
- `simulateEconomy(samples: RunSummary[] (with seconds), runs: RunsConfig, boosts: BoostsConfig, opts: { minutesPerDay: number; at: Date }) → { perRun: { coins, dust, material, signals }[]; perDay: { coins, dust, material, signals }; capped: number }`.

- [ ] **Step 1: Dataviz skill:** the comparison is a table (live against draft, with the difference), not a chart, unless a chart earns its place.
- [ ] **Step 2: Failing tests:**
  - shared:
    - `'el simulador paga lo mismo que finishRun para la misma partida'` (same `runPayout`, `runMaterial` and daily rules);
    - `'el día reparte las partidas por el rendimiento diario'`;
  - web:
    - `'el simulador compara lo vivo y el borrador y lo dice como estimación'`;
    - `'un borrador que no valida no simula'` (Focus 4);
    - `'se puede parar'` (Focus 5).
- [ ] **Step 3: Implement:** the bot plays 3 sample runs of the chosen length in the chosen sector, in slices, with a stop button; the table compares the live config and the draft.
- [ ] **Step 4: Run** the suites; render and look.
- [ ] **Step 5: Commit** `feat(galaxy): simulador de la economía con la configuración en edición`.

### Task 4: e2e and PRE docs

- [ ] **Step 1: e2e** `admin-economy.spec.ts`:
  - a CLI admin opens Configuración, then `runs`;
  - changes the death share in the draft (without publishing) and runs the simulator;
  - the draft column differs from the live one;
  - nothing is published (the version stays);
  - no CSP violations.
- [ ] **Step 2: DEPLOY_PRE step 27** (the `boosts` key, how to schedule «doble polvo el fin de semana», what players see, the simulator).
- [ ] **Step 3: Commit** `test(galaxy): e2e del simulador de economía y paso 27 de PRE`.
