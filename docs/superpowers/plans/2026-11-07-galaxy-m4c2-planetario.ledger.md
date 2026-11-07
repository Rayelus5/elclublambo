# SDD ledger — plan: docs/superpowers/plans/2026-11-07-galaxy-m4c2-planetario.md

Spec: games/galaxy/docs/GDD.md §10.5, §14.2, §8.5 (reachable).
Pre-flight:
- T1→T3: prestige(), planetariumBonus(), PlanetariumView/Card/Visit, PublicGalaxy, exhibitsSchema, usernameParamSchema, errors galaxy_exhibited/planetarium_not_found — consistent names; PublicGalaxy keeps PulledGalaxy's id (every galaxy route checks ownership, so an id leaks nothing).
- T2→T3: galaxy.exhibits / galaxy.planetarium_visits — consistent.
- T3→T4: GET/PUT /planetarium, GET /planetarium/visit/:username, GalaxySummary.exhibited — consistent.
- T4→T5: Dome.tsx is created in T4 and gets its strip in T5 — T4 draws the dome as a CSS fallback until T5 lands.
- Task 1: Ruling: the two new error codes get their web copy in Task 1 (copy.errors satisfies Record<ApiErrorCode, string>, so typecheck needs it) — cost if wrong: none
Task 1: complete (commits 3aee67a..1139296, tests: pnpm -C games/galaxy exec vitest run --project unit packages/shared →    Duration  2.65s (import 53%, transform 30%, tests 16%, worker 1%))
- Task 2: Ruling: pgTAP has 14 checks instead of 7 (privileges split per table, the FK that keeps an exhibited galaxy from being deleted, the UTC default day); galaxies are soft-deleted (disintegrated_at), so the server's 409 is the real guard and the FK only covers hard deletes — cost if wrong: none
Task 2: complete (commits 1139296..ceb7908, tests: pnpm exec supabase test db → PASS, 110 files, 4901 tests)
- Task 3: Ruling: featured ties break by the newest account first (then id) — fresh displays win ties, and it keeps the shared-DB test deterministic; banned accounts are left out of featured (still visitable by name) — cost if wrong: order of equal-prestige cards
- Task 3: Ruling: GalaxySummary.exhibited is present only when true (exhibited?: true), so existing summary shapes and tests stay as they were; an exhibited galaxy that is also equipped shows both — cost if wrong: none
- Task 3: Ruling: exhibiting moves no currency, so PUT /planetarium/exhibits is not an idempotent operation (like PUT /hangar/loadout); it takes an advisory lock and locks the chosen rows so a concurrent disintegrate/fuse either waits and sees it exhibited or wins and the PUT answers 404 — cost if wrong: none
- Task 3: Ruling: visits and exhibits are rate-limited per account (120/min and 60/min) — cost if wrong: a heavy visitor waits a minute
Task 3: complete (commits ceb7908..b01d9a5, tests: pnpm -C games/galaxy exec vitest run --project integration apps/server/test/integration →    Duration  40.49s (tests 55%, import 43%, transform 1%))
- Task 5: Ruling: Task 5 (the dome) runs before Task 4 — the screen places its cards over the painted pedestals, so its layout and screenshots need the real scene; DOME (size, frames, pedestal centres and top) lives in planetarium/art.ts for both — cost if wrong: none
- Task 5: Ruling: the painted layers are cupula, rayos, estrellas, escenario, hologramas, proyector (the plan named retícula/pedestales/haces: the grid is part of the dome layer, the pedestals of the stage, the beams are the holograms) — cost if wrong: none
Task 5: complete (commits b01d9a5..4c69c88, tests: pnpm -C games/galaxy exec vitest run --project web apps/web/test/planetarium-art.test.ts →    Duration  1.42s (environment 67%, setup 27%, transform 3%, tests 2%))
- Task 4: Ruling: planetarium.slots is capped at 6 (was 1–8): the dome's art has six pedestals, more would be exhibitable but invisible; the DB check and exhibitsSchema keep 8 as headroom — cost if wrong: new art plus a config bump to grow it
- Task 4: Ruling: the Hangar's RelicPicker became a generic cards/GalaxyPicker (title, empty text, pick label, taken badge) that both the Hangar and the planetarium use — cost if wrong: none (Hangar tests unchanged and green)
- Task 4: Ruling: the visit form also sits on the visit screen and on the «no planetarium» screen (a dead end otherwise, ui-ux-pro-max «No results»); an impossible name (400) reads as not found; the visit query does not retry a 4xx — cost if wrong: none
- Task 4: Ruling: no username autocomplete in the visit field — it would list accounts to anyone signed in — cost if wrong: players type names in full
- Task 4: Ruling: an empty pedestal is a dark dashed slot over the hologram (text contrast on the beams), the cards glow cyan; the screen's shots at 1280/1600/1920 were reviewed (side column overflow at 1280 found and fixed: minmax(0,1fr) column, the field's button wraps) — cost if wrong: none
Task 4: complete (commits 4c69c88..c6f336d, tests: pnpm -C games/galaxy exec vitest run --project web → 37 files, 238 passed)
- Task 6: Ruling: the e2e does not check that the visitor sees the owner in the featured list (plan Task 6): featured is the global top 8 by prestige, and a fresh two-galaxy account is not in it on a shared DB (CI runs integration first); featured order, exclusions and the cover are pinned by the integration test, the list's links by the web test — cost if wrong: a featured regression only integration would catch
- Task 6: complete (e2e planetarium.spec.ts 1/1 locally with setup; DEPLOY_PRE step 13), commit 1df1008
Final review: opus reviewer — no Critical, 1 Important, 10 Minor; Ready with fixes.
- Final: fixed a failed exhibit was silent behind the open picker (and pedestal buttons stayed live while saving) — «si exponer falla, el diálogo se cierra, el error se ve…» and «mientras se guarda, los pedestales no envían otra fila» RED→GREEN; the picker closes on pick like the Hangar's, pedestal buttons are disabled while the PUT is pending, onError also invalidates the collection (the reopened picker re-reads anyway: its pages query has no staleTime, so the test pins the behaviour, the invalidation covers the 30 s collection queries); web suite 37 files 241/241
- Final: fixed (re-graded from Minor 3, the copy misleads today) the prestige hint said «una más» (one more galaxy) for one more point — «el prestigio explica que el acabado suma un punto más» RED→GREEN, suite 241/241
- Final: Ruling: Task 3's «an exhibited galaxy that is also equipped shows both» holds for the API only; the web shows «Equipada» and the hangar reason first, and the planetarium's once un-equipped — a two-step discovery, deferred as a minor — cost if wrong: one extra trip for a player who did both
- Final: minor (deferred): lowering planetarium.slots leaves galaxies on hidden pedestals exhibited (badge, 409) until the next PUT; exhibitedColumn/isExhibited should only count slot <= cfg.slots
- Final: minor (deferred): a galaxy both equipped and exhibited shows only «Equipada» and the hangar reason
- Final: minor (deferred): the prestige hint hard-codes the live cap (5 %) and the finish point; PlanetariumView could carry cap and points
- Final: minor (deferred): featured runs up to 8 parallel exhibitsOf queries (8 of 10 pool connections) and a full aggregate on every GET/PUT; fetch covers in the same query
- Final: minor (deferred): a11y — an empty pedestal on a visit is an unlabeled li; focus falls to body after «Retirar» or a pick; filled pedestals do not say their number
- Final: minor (deferred): the visit query treats a network error (status 0) as a 4xx and does not retry it
- Final: minor (deferred): the dome's plate lights cycle every 3 frames over an 8-frame loop, a small hitch at the wrap every 1.6 s
- Final: minor (deferred): planetarium/service.ts duplicates the collection's SUMMARY columns and the equipped subquery
