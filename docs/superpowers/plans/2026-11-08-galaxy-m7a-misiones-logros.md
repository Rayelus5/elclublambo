# Galaxy Survivor M7a · Misiones y logros

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GDD §12.3, §12.1 and §14.1:
- **daily missions** (3–5), **weekly** and **season** ones, each with a reward to collect;
- **achievements** that give titles, frames and signals («boletos»);
- the profile shows the chosen title and frame;
- mission and achievement points add to the season's General ranking.

**Architecture:**
- **Live config:**
  - `missions`: `daily` and `weekly` (how many and from which pool), `season` (a fixed list); each mission is `{ id, name, stat, target, reward }`;
  - `achievements`: a list of `{ id, name, description, stat, target, reward: { signal?, title?, frame? } }`.
- **Stats** are counted where they happen:
  - a run's finish: `runs`, `minutes`, `kills`, `bossKills`, `extractions`, `depth` (deepest);
  - a pull: `pulls`, `legendaries`;
  - `fusions` and `disintegrations`;
  - `refinery`: components collected.
- **Migration** `*_galaxy_missions`:
  - `mission_progress` (account, period, mission, progress, claimed_at);
  - `achievement_progress` (account, achievement, progress, unlocked_at, claimed_at);
  - `cosmetics` (account, kind title|frame, id);
  - `accounts.title` and `accounts.frame`;
  - `season_adjustments.source` (`admin` | `mission` | `achievement`).
- **Periods:**
  - the day is Madrid's day, as the daily yield;
  - the week is the ISO week in Madrid;
  - the season is `season.id`.
  
  The day's and the week's missions are the same for everyone, drawn from the pool with the period as seed.
- **Claiming** credits the reward in the ledger (`mission` / `achievement`), adds season points as a `season_adjustments` row with its source, and unlocks the title or frame.
- **Web:**
  - `/misiones` with the tabs Diarias, Semanales, Temporada and Logros (progress bar, «Recoger», what it gives);
  - a top-bar button with a badge for what is ready to collect;
  - the profile shows the title under the name and the frame round the avatar;
  - «Personalizar» on one's own profile chooses them.

**Spec:** `games/galaxy/docs/GDD.md` §12.1, §12.3, §14.1, §16.2 (missions, achievements, titles and frames are admin-editable: the config editor for definitions; per player in a later part).

## Global Constraints

- **Owner's directive (2026-11-08):** speed to PRE. Only the tests a change touches; CI gates the merge.
- **Suspicious runs** count for nothing (as for the season).
- **Rewards are paid once:** an idempotent claim on a guarded update.
- **Frames:** for now a ring in the colour of the achievement's tier (CSS). Aseprite frames can come later.
- **Copy:** Spanish, direct titles, no special symbols in titles, no final period.

---

### Task 1: Config, migration, counting and claiming (server)

- [ ] **Tests** (integration, `missions.test.ts`):
  - a run counts towards its missions and achievements;
  - collecting pays once and adds its season points;
  - the day's missions are the same for two accounts;
  - an achievement unlocks its title;
  - a suspicious run counts nothing.
- [ ] **Implement:**
  - the config keys;
  - the migration;
  - `progress/missions.ts` (`countStat(trx, account, stat, amount, now)`, `missionsView`, `claimMission`, `claimAchievement`);
  - the hooks in finishRun, pull, fusion, disintegration and refinery collect;
  - the routes:
    - `GET /galaxy/api/missions`;
    - `POST /galaxy/api/missions/:period/:id/claim`;
    - `POST /galaxy/api/achievements/:id/claim`;
    - `PUT /galaxy/api/profile/cosmetics`;
  - the profile's title and frame.
- [ ] **Commit** `feat(galaxy): misiones diarias, semanales y de temporada, y logros con títulos y marcos`.

### Task 2: Web

- [ ] **Tests** (web):
  - the tabs list missions with progress and «Recoger»;
  - collecting calls the claim;
  - the badge counts what is ready;
  - the profile shows the title and frame.
- [ ] **Implement** `/misiones`, the top-bar button, the profile and «Personalizar»; consult ui-ux-pro-max; DESIGN_SYSTEM §8 quinvicies.
- [ ] **Commit** `feat(galaxy): pantalla de misiones y logros, y título y marco en el perfil`.

### Task 3: PRE docs

- [ ] DEPLOY_PRE step 28 (the migration, the two config keys with the default missions and achievements, what players see).
- [ ] **Commit** `docs(galaxy): paso 28 de PRE`.
