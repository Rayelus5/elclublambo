# SDD ledger — plan: docs/superpowers/plans/2026-11-08-galaxy-m5a-perfiles-clasificacion.md

Spec: games/galaxy/docs/GDD.md §12.1, §14.1, §14.2, §13.1, §4, §11.3 bis (reachable).
Pre-flight:
- T1→T2: the backfill formula in SQL (galaxy.run_xp) must equal runXp with the default `account.xp` — pinned by a pgTAP row and by the T1 unit values (10/min floored, 15/layer, 40/Core, 30/extraction).
- T1→T3: runXp, levelOf, seasonPoints, seasonTier, seasonOpen, Leaderboard/Profile/PublicCollectionPage, RunResult.progress, MeResponse.level, leaderboardQuerySchema, publicCollectionQuerySchema, profile_not_found — consistent.
- T3→T5: GET /leaderboard, /profiles/:username, /profiles/:username/galaxies — consistent.
- T4→T5: tierArtUrl(tier) — consistent.
- Task 1: Ruling: MeResponse.level is optional and only /auth/me sends it (the sign-in answers build MeResponse in seven places and the top bar reads /auth/me) — cost if wrong: a screen that reads level from a sign-in answer sees undefined
- Task 1: Ruling: RunResult.progress moves to Task 3, where finishRun fills it (required in Task 1 it broke the server's typecheck) — cost if wrong: none
- Task 1: Ruling: season has `top` (3–500, default 100) so the integration test can put «me» outside the top with fixedConfig — cost if wrong: none
Task 1: complete (commits 847a43d..59d214b, tests: pnpm -C games/galaxy exec vitest run --project unit packages/shared/test/progress.test.ts →    Duration  524ms (import 55%, transform 41%, tests 3%, worker 1%))
- Task 2: Ruling: the backfill is checked through the SQL formula galaxy.run_xp (pgTAP pins it to the same values as runXp's unit test); the migration has already run here, so its insert … select is not re-run by the test — cost if wrong: a backfill bug would only show on PRE's existing accounts
- Task 2: complete (commits 59d214b..85303f5, tests: pnpm exec supabase test db → PASS, 111 files, 4913 tests)
- Task 3: Ruling: the integration test gives each block its own season on a random month between 1990 and 2019 through fixedConfig — a future clock signed the sessions out (they expire by the database's now() but are read against the app's clock) and the past is free of other tests' runs — cost if wrong: none
- Task 3: Ruling: tie order inside a shared rank: general and purges by the last scoring run (earliest first), depth by the first run that reached the deepest layer; banned accounts are left out of the ranking (they still have a profile) — cost if wrong: the order of equal rows
- Task 3: Ruling: profiles and public collections share one per-account limit (120/min); the leaderboard is not limited (cached 30 s) — cost if wrong: a scraper reads the cached leaderboard as often as it wants
- Task 3: Ruling: /auth/me's contract gains `level` (auth-routes test updated to the new shape) — cost if wrong: none
Task 3: complete (commits 85303f5..9b89ca2, tests: pnpm -C games/galaxy exec vitest run --project integration apps/server/test/integration → 191/191; the login rate-limit test flaked once on a 10-min window edge and passed on re-run)
- Task 3: minor (pre-existing, deferred): auth-routes «el 31.º login… → 429» can flake when its 31 logins straddle a fixed 10-minute rate-limit window
- Task 4: Ruling: after the first contact sheet, Bronce lost its two top rivets (with the chevron they read as a face) for an inner heraldic border, and Estelar's spiral got a smaller core, arms from r 2.4 and fixed stars (the core read as a glyph) — cost if wrong: none
Task 4: complete (commits 9b89ca2..1075efd, tests: pnpm -C games/galaxy exec vitest run --project web apps/web/test/tier-art.test.ts →    Duration  1.75s (environment 54%, setup 21%, transform 12%, import 12%, tests 1%))
- Task 5: Ruling: the leaderboard tabs are links of the existing `.tabs` pattern with the tab in the address (?pestana=profundidad/purgas; ui-ux-pro-max «Deep Linking»), not an ARIA tablist (plan Step 1) — shareable, and no arrow-key contract to half-implement — cost if wrong: none
- Task 5: Ruling: the title screen's right column swaps the collection summary for the season (GDD §4 asked for it; the collection stays reachable from its tile); the CollectionSummary component and its `.best` styles are gone — cost if wrong: the six rarest galaxies are no longer listed on the title screen (they still drift in its backdrop)
- Task 5: Ruling: the tiers panel always goes by the season score (it reads the General leaderboard, cached) whatever tab is open — cost if wrong: one extra cached request on the other tabs
- Task 5: Ruling: shots at 1280/1600/1920 reviewed — the Ranking tile's «Ver la temporada» wrapped and clipped at 1280 (now «Temporada»), the points header now aligns right with its values — cost if wrong: none
Task 5: complete (commits 1075efd..fc83c76, tests: pnpm -C games/galaxy exec vitest run --project web → 40 files, 256 passed)
- Task 6: Ruling (found writing the e2e): finishing a run clears the leaderboard cache — with only the 30 s cache, the results said «+85 puntos» while the title screen kept the old score; test «terminar una incursión refresca la clasificación al momento» RED→GREEN — cost if wrong: under heavy play the cache helps less (one aggregate per read after each finish)
- Task 6: Ruling: the e2e plays a one-second run through the API (start + finish, plausible) instead of inserting runs — a real finish exercises the experience, the points and the cache clearing; it reads the player's row wherever it lands (podium, table or pinned) since the local DB has many scored accounts — cost if wrong: none
- Task 6: complete (e2e social.spec.ts 1/1 locally with setup; DEPLOY_PRE step 14)
Final review: opus reviewer — no Critical, 3 Important, 14 Minor; Ready with fixes.
- Final: Ruling (Important 1, scoring): a run counts for experience and points from account.minRunSeconds (60, like probe unlocks and slot milestones), and gives at most account.xp.capPerMinute (30) experience and season.capPerMinute (20) points per minute it lasted — instant deaths earn nothing and a forged one-minute run is worth what a real one is; an honest run never meets the caps (5-min layer: 85 points of 93, 125 XP of 140) — cost if wrong: honest edge cases capped by a few points; forging is still bounded by real time until replays are verified
- Final: fixed instant runs farmed points and experience — progress.test «menos de un minuto no da…», «un minuto da como mucho 30… y 20…» RED→GREEN; integration «empezar y morir enseguida no da experiencia ni puntos»; pgTAP run_xp(59…)=0 and run_xp(60…)=30 RED→GREEN via migration 20261108001508_galaxy_progress_min_run (replaces run_xp, recounts account_xp); leaderboard SQL and profile filter seconds ≥ min and cap per run
- Final: fixed integration seasons could collide with this file's own leftovers — random minute over 30 years, 3-day window (collision negligible); social.test 11/11
- Final: fixed the e2e would break when season 1 closes (2026-12-13) — it reads whether a season is open and checks the closed path (no points, «No hay ninguna temporada abierta») otherwise; it now plays a one-minute run (+25 XP, +10 points); e2e 1/1 (1.1 min)
- Final: fixed (re-graded from Minor 4: it undid Task 6's fix) cache race — cachedRanking keeps the promise with a generation, an in-flight aggregate is never kept after an invalidation, reads share one query, failures are forgotten; leaderboard-cache.test 3 tests RED→GREEN
- Final: fixed (re-graded from Minor 5: a crash) ResultsScreen with a result stored before M5a — «un resultado guardado antes de M5a…» RED→GREEN
- Final: fixed (re-graded from Minor 6) the season column stayed «Cargando» on an error — hub «si la temporada no llega…» RED→GREEN
- Final: fixed (re-graded from Minor 7, a11y) the avatar link's aria-label hid the visible username — now named by its content plus «, tu perfil»; hub test RED→GREEN
- Final: fixed (re-graded from Minor 9) «Termina hoy» could never show — whole days left (floor); leaderboard/hub tests RED→GREEN
- Final: fixed (re-graded from Minor 10) emblems at a non-integer ×1.5 — TierEmblem takes scale 1|2; «los emblemas van a escala entera» RED→GREEN
- Final: fixed (re-graded from Minor 11) the players count changed with the tab — taken from General; tabs test RED→GREEN
- Final: fixed (re-graded from Minor 16, a11y) podium ranks were aria-hidden (ties announced 1,2,3) and the pinned row had no headers — sr-only «Puesto N», sr-only thead; podium/pinned tests RED→GREEN; web 40 files 259/259
- Final: minor (deferred): General's tie-break uses max(finished_at) of all counted runs, not of the last scoring one (differs only if points.layer is 0); depth's array_agg order puts NULL depths first
- Final: minor (deferred): `since` exposes the sign-up time to the millisecond (the UI shows month and year)
- Final: minor (deferred): hub copy summaryTitle/summaryEmpty/summaryBest/scanNow/openCollection is dead since CollectionSummary left
- Final: minor (deferred): no integration test pins that banned accounts are left out of the ranking
- Final: minor (deferred): one's own profile reads in the third person («Ver su colección», «Todavía no ha puntuado…»)
- Final: minor (deferred): a missing public collection still shows the rarity chips and an empty grid
- Final: minor (deferred): after signing in, the top bar has no level until /auth/me refreshes (setQueryData from the sign-in answer, staleTime 60 s)
- Final: Ruling (declined-to-judge line): runs flagged only for loot_cap/payout_cap are «suspicious» and give no experience or points — pre-existing semantics (M3a) and the spec says suspicious runs do not count — cost if wrong: an exceptional honest run shows +0 de experiencia
- Final: fixed hub.spec (e2e) still asked for the removed collection panel — it now checks the season column (open or closed) and the Ranking link; found by the full e2e run (24/26 → hub.spec 3/3)
