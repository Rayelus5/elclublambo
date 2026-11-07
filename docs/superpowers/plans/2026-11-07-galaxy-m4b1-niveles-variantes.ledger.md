# SDD ledger — plan: docs/superpowers/plans/2026-11-07-galaxy-m4b1-niveles-variantes.md
Spec: games/galaxy/docs/GDD.md §6 (Mejoras), §5.3, §8.6, §11, §17.5; DESIGN_SYSTEM.md §8 ter. Executor: inline (executing-plans), branch feature/galaxy-m4b1 from develop 59cac93.
Pre-flight:
- T1→T2: T2 consumes baseOf, StatBonus, WeaponDef, ProbeDef from @galaxy/sim — StatBonus and the content interfaces are already exported; baseOf is a T1 product (export it from the index). Ruling: WeaponDef in content/types.ts is a hand-written interface beside the Zod schema, so T1 adds `variant?` to both — cost if wrong: none
- T2→T4: probeCards(…, levels) and startingWeapon — consistent
- T3→T4: galaxy.probe_levels and runs.upgrades — consistent
- T4→T5: level-up/variant routes and the new ProbeCard/RunStart fields — consistent
- T1→T6: T1's variants carry their base's icon until T6 gives each its own icon-<id> — consistent
- T2: probe_locked already exists in errors.ts; only probe_changed, probe_maxed, variant_locked are new
- Task 1: Ruling: a «twin» variant is not a flat ×0.6: it spreads its base's total damage over one more shot, less 5 %, level by level (count/(count+1) × 0.95), because a base with one shot at its top level would reach 1.2× with ×0.6 — cost if wrong: none (the parity test pins 0.75–1.15)
- Task 1: Ruling: variants are appended to DEFAULT_CONTENT.weapons after the literal (built from their bases by variantOf); offers skip them unless owned, so runs without variants draw the same offers as before — cost if wrong: none
- Task 1: Ruling: the random builds also draw variants as weapons (their root is baseOf) besides playing with VETERAN bonuses — cost if wrong: none (builds short run green under the ceilings)
Task 1: complete (commits 81ad54a..e26bec7, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim → 20 files, 297 passed | 6 skipped; typecheck, lint, web 196/196)
- Task 2: Ruling: probeCards lives in the server (apps/server/src/runs/hangar.ts), not in shared as the plan says; shared gets the pure probeVariantCards(probe, level, content) it uses, and probeCards takes the levels map (default {}) — cost if wrong: none
- Task 2: Ruling: until Task 4 wires the table, the server gives every probe level 1 with its base weapon and RunStart bonuses [] / variant null, so the build stays green between tasks — cost if wrong: none
- Task 2: Ruling: the probes.levels defaults are pinned in packages/shared/test/probe-levels.test.ts (parseConfig default) instead of registry.test.ts — cost if wrong: none
- Task 2: Ruling: web fixtures build the level fields with a shared helper apps/web/test/probe-cards.ts (levelOne) — cost if wrong: none
Task 2: complete (commits e26bec7..0e81a8b, tests: pnpm -C games/galaxy exec vitest run --project unit packages/shared → shared 107/107; typecheck, lint, web 196/196, integration hangar+runs+probes 27/27)
- Task 3: Ruling: pgTAP also checks service_role cannot read probe_levels (the M4a review's minor) — cost if wrong: none
Task 3: complete (commits 0e81a8b..42a4c90, tests: pnpm exec supabase test db → 107 files, 4875 PASS (977 RED→GREEN); server typecheck)
- Task 4: Ruling: hangarView takes an optional db (the action's transaction) so a level-up returns the view with its own change before commit — cost if wrong: none
- Task 4: Ruling: check order is exists (400) → owned (409 probe_locked) → maxed (409 probe_maxed) → expected level (409 probe_changed) → debit; a stale request at the top answers probe_maxed — cost if wrong: which 409 a player sees
- Task 4: Ruling: choosing a variant needs the probe owned (409 probe_locked) and is a plain upsert without idempotency key (setting a value twice is the same) — cost if wrong: none
Task 4: complete (commits 42a4c90..32c21f8, tests: pnpm -C games/galaxy exec vitest run --project integration → 19 files, 155/155 (probe-levels 11 RED→GREEN); typecheck, lint)
- Task 5: Ruling: the stats row «Arma inicial» left the probe detail (the picker with that legend replaces it, so the label is not repeated) — cost if wrong: none
- Task 5: Ruling: the Hangar's balance shows components (WalletBar gains an opt-in components prop), since a level costs them — beyond the brief — cost if wrong: one more chip in the bar
- Task 5: Ruling: the weapon choice shows at once (the pending choice) and the server's answer confirms it — ui-ux-pro-max: set the final state directly — cost if wrong: none
Task 5: complete (commits 32c21f8..3aa99c6, tests: pnpm -C games/galaxy exec vitest run --project web → 32 files, 202/202; typecheck, lint; hangar shots at 1280/1600/1920 reviewed)
- Task 6: Ruling: the Lua painter is self-contained (it repeats the few helpers of paint-rooms.lua instead of a shared lib) — one file per art set, each runnable alone — cost if wrong: ~60 duplicated lines
- Task 6: Ruling: the turret's shells take the solar ramp (its body stays steel), so its hack variant tints the shells green; drawn shells in grey did not read — cost if wrong: none
- Task 6: Ruling: the variants' HUD icons are derived by rule from their base icon (element inks, or a 4×4 corner mark), not painted, since at 12×12 the base drawing is what the player knows — cost if wrong: none
Task 6: complete (commits 3aa99c6..1d43cc1, tests: pnpm -C games/galaxy exec vitest run --project unit --project web → 88 files, 1052 passed | 6 skipped; lint, typecheck; contact sheets and hangar shots reviewed)
Final review: fresh opus reviewer on review-59cac93..4e964bf — 0 Critical, 3 Important, 9 Minor; all 18 rulings upheld
- Final: fixed Torreta rápida dealing 0.65× (turret cooldown only re-places turrets) and the nominal parity hiding it — «una variante rinde parecido a su base, medido en la simulación (anillos y multitud)» RED (nova-wide 1.51 also caught) → GREEN with turret-rapid interval ×0.65 and nova-wide damage ×0.7; variants 13/13
- Final: fixed Disco perforante's no-op pierce (discs never pierce) — «una variante no cambia lo que su tipo de arma no usa» RED→GREEN; now «Disco de brecha», breach at ×0.85
- Final: fixed the Hangar staying stale after a 409/402 level-up — «una subida rechazada (otra pestaña ya subió)…» RED→GREEN (onError refreshes Hangar and wallet; the variant choice refreshes the Hangar); unit+web 1054 passed | 6 skipped
- Final: Ruling: re-graded minor «DEPLOY_PRE step 10 lacks the published content note» to Important — a stored content would silently open no variants at levels 4 and 8 — added the note with the game_config_active check — cost if wrong: none
- Final: Ruling: Rayo partido stays a twin that splits over distinct targets (0.95 on rings, 0.98 in a crowd, weaker on a lone boss); its description now says «a dos enemigos distintos» — a sidegrade for crowds — cost if wrong: a weaker beam against bosses for whoever picks it
- Final: minor (deferred): Dron doble on Sentinel (overwatch +1 drone) dilutes the twin bonus at low weapon levels (0.71× at L1)
- Final: minor (deferred): choosing a weapon compares with the server's value, not the pending one; quick back-and-forth can drop the second choice
- Final: minor (deferred): ProbeLevel and WeaponPicker have no key={probe.id}, so a previous probe's error can linger after switching
- Final: minor (deferred): chooseVariant uses the stored level without clamping to the config's max level
- Final: minor (deferred): content schema accepts an evolution from a variant and a probe whose weapon is a variant
- Final: minor (deferred): the evolve card says «Evoluciona Pulso láser» while the slot holds its variant; probe tiles show the base weapon's name
- Final: minor (deferred): copy.hangar.statNames names 11 of the 20 stats (raw key for others)
- Final: minor (deferred): station doc comment sits above ProbeLevelsTable; hangar.ts/levels.ts import each other; «Te faltan…» not tied with aria-describedby
- Task 7: Ruling: the e2e clicks the weapon radio and waits for toBeChecked (check() read a React-controlled radio before it settled and failed once after passing in the full run; the page snapshot showed it checked) — cost if wrong: none
Task 7: complete (commits 1d43cc1..8a05c11, tests: full e2e 21/21 before the fix pass and probe-levels e2e 2/2 after it; pnpm -C games/galaxy test → 117 files, 1255 passed | 7 skipped; GALAXY_CALIBRATE=1 sim 304/304; pgTAP 4875; root TZ=UTC unit 5410/5410; Docker galaxy-m4b1:local smoke (health db up, /galaxy/incursion 200, level-up 401, weapon strip image/png 200))
