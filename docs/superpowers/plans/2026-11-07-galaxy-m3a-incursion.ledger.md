# SDD ledger — plan: docs/superpowers/plans/2026-11-07-galaxy-m3a-incursion.md

Spec: games/galaxy/docs/GDD.md + games/galaxy/docs/DESIGN_SYSTEM.md (reachable). Branch feature/galaxy-m3a from develop 145eecc (plan commit 8fe4ddb).

## Pre-flight (shared interfaces)
- T1 → T3..T9: Rng/sinA/cosA/angleTo/diminish/ticks — consumers use the same names. Clean.
- T2 → T3..T9, T11 (RunStart.content), T13 (sprite/icon ids), T15: Content types — clean.
- T3 → T4..T8, T13, T14: Sim, pools, HitSource, deriveStats, Offer, relicBonuses hook (filled by T7) — clean after the plan's self-review moved stats/upgrades into T3.
- T9 → T12 (decodeLog for bad_inputs + logTicks), T14 (encodeLog/toBase64) — clean.
- T8 → T14: hudSnapshot — clean. T7 → T15: describeRelic (web imports @galaxy/sim) — clean.
- T11 → T12, T15: API schemas — CONFLICT: T11 adds `GalaxySummary.equipped`, but the server only provides it in T12, so T11's commit would break the server typecheck.
  Ruling: `equipped` (shared type + server query) moves to T12, the task that owns the server change — cost if wrong: none (same final code, one task later).
- T13 → T14: createStage/Stage — clean. T14 → T15: ArenaScreen/RunEnd — clean.
Task 1: complete (commits 8fe4ddb..c82b9ad, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim →    Duration  385ms (tests 44%, transform 33%, import 21%, worker 3%))
Task 2: complete (commits c82b9ad..456aab4, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim packages/shared →    Duration  2.06s (tests 54%, import 31%, transform 13%, worker 1%))
- Task 3: Ruling: spawnEnemy (basic: species, position, elite, scale) lands in Task 3 instead of Task 4, because the core tests need enemies to touch and kill — Task 4 adds behaviours, elites and the director on top — cost if wrong: none (same function, earlier).
Task 3: complete (commits 456aab4..35e68b3, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim →    Duration  554ms (import 54%, tests 24%, transform 19%, worker 2%))
Task 4: complete (commits 35e68b3..d199fb8, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim →    Duration  9.45s (tests 84%, import 11%, transform 4%))
- Task 5: note — the weapon tests were first run after the implementation; their RED was proven by unwiring fireWeapons/updateShots/updateAreas from step (git stash): 12/13 failed for the missing behaviour (the 13th asserts no fire without targets).
Task 5: complete (commits d199fb8..a2ffe4a, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim →    Duration  9.99s (tests 81%, import 13%, transform 5%, worker 1%))
Task 6: complete (commits a2ffe4a..e5aef56, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim →    Duration  10.34s (tests 79%, import 15%, transform 6%, worker 1%))
- Task 7: Ruling: RelicSkill gains `copies` (the family a merger copies) and `share` (0.8) beyond the plan's field list — the echo family cannot be described without them — cost if wrong: two fields.
- Task 7: Ruling: relic radii grow with half of the magnitude above 1 (a Legendary ×2 hits twice as hard with 1.5× the radius) — GDD §8.3 ties size to "radio y daño" but full scaling made legendary auras/blades cover the screen — cost if wrong: one function (radiusScale).
- Task 7: Ruling: extra projectiles (Splitter, Einstein ring) also add rays to barred-spiral relics; aura and pulse intervals scale with star density but not with the Capacitor — cost if wrong: tuning.
- Task 7: note — relic tests first ran after the implementation; RED proven by removing systems/relics.ts: 25/25 failed (relicSkill is not a function).
Task 7: complete (commits e5aef56..c40baec, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim →    Duration  10.58s (tests 76%, import 18%, transform 6%, worker 1%))
- Task 8: Ruling: the beacon's hold counts while every living probe is inside (co-op leaves together); HudSnapshot.hold/holdNeeded are in seconds — cost if wrong: one comparison.
Task 8: complete (commits c40baec..ea71341, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim →    Duration  9.99s (tests 71%, import 20%, transform 9%, worker 1%))
- Task 9: Ruling: calibration (GDD §5.6) retuned DEFAULT_CONTENT — pulse cooldown 0.9→0.55…0.4 s; mite groups 4–8→3–5; density base 0.6→0.3/s, +0.12→+0.18 per minute, alive cap 320→240; boss life 1800→1200, radial 10→8, aimed 12→9, boss per layer life +0.7→+0.5 and damage +0.25→+0.2; sector life per minute +8 %→+6 %, per layer life +50 %→+35 %, damage +20 %→+15 %. Bot result (5 seeds, typical build): layers 3,1,4,2,3 (avg 2.6) at 22.6/17.3/30.4/9.7/16.7 min (avg 19.3) — inside the 2–4 layers / 5–20 min target. Cost if wrong: numbers in the live config (editable without a deploy).
- Task 9: Ruling: new repair kits (pickup kind 3): 0.4 % per kill, always from elites, heal 25 % of max life (content drops.repair / repairHeal). Without any in-run healing the bot died to chip damage by minute 5; the genre relies on such drops — cost if wrong: two content numbers.
- Task 9: Ruling: "a normal run" for calibration = the bot with a typical build (the welcome Legendary + an Uncommon, GDD §9) that keeps pushing deeper (it never extracts) and fights the boss at mid range; the CI short check keeps the bare starter probe. Extreme all-Legendary level-10 builds may reach 40× the median random build (GDD §8.6: brakes stop breaking, not shining); random builds stay ≤ 8× — cost if wrong: thresholds in one test.
- Task 9: note — the recording/calibration tests were run red before the implementation (8/8 failed: botInput not a function; the combo check failed on the first extreme build).
Task 9: complete (commits ea71341..d27f92a, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim →    Duration  7.80s (tests 64%, import 25%, transform 10%, worker 1%))
Task 10: complete (commits d27f92a..636ebac, tests: pnpm exec supabase test db → We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli)
- Task 10: note — the task-done line above shows the CLI's update notice; the run itself was 'Result: PASS' with 973_galaxy_runs ok (exit 0).
Task 11: complete (commits 636ebac..39fcd8c, tests: pnpm -C games/galaxy exec vitest run --project unit packages/shared →    Duration  1.92s (tests 44%, import 39%, transform 16%, worker 1%))
- Task 12: Ruling: `GalaxySummary.equipped` is optional (absent = not equipped) — the client builds summaries in tests and older payloads; the server always sends it — cost if wrong: one type.
- Task 12: Ruling: a duplicate galaxy in a loadout is refused by the request schema (400 invalid_input), not 409 — the plan listed it with the 409 cases — cost if wrong: one status code.
- Task 12: Ruling: plausibility uses the current content's layer length (not the run's content version); the run row keeps its content version for later replays — cost if wrong: a content change mid-run could flag a few runs.
- Task 12: fix — migration renamed 20261107030626 → 20261107020626 (UTC creation time; the deploy guard compares in UTC); local DB history repaired with `supabase migration repair --local` (no data touched).
Task 12: complete (commits 39fcd8c..63439e4, tests: pnpm -C games/galaxy exec vitest run --project integration --project unit apps/server →    Duration  24.38s (tests 49%, import 49%, transform 1%, worker 1%))
- Task 13: Ruling: Stage gains `feed(events)` (one call per simulation step) and `camera()` beyond the plan's render/resize/destroy — the juice is driven by the step's events and tests read the camera — cost if wrong: two methods.
- Task 13: Ruling: nebula clouds are a seamless, domain-warped dithered layer at 25 % parallax instead of per-chunk cloud sprites (the chunk clouds read as blocky stamps in the screenshots); chunks keep rocks and braille dust — cost if wrong: the terrain's cloud entries are unused.
- Task 13: fix found by the sprite-sheet screenshot — the relic ray shot sprite was also called `ray` and overwrote the Void Manta; renamed `relic-ray`, guarded by a test (ids of loot/shots/icons never collide with fauna).
Task 13: complete (commits 63439e4..3dac8af, tests: pnpm -C games/galaxy exec vitest run --project web --project browser apps/web/test/sprites.test.ts apps/web/test/camera.test.ts apps/web/test/terrain.test.ts apps/web/test/fx.test.ts apps/web/test/browser/arena.browser.test.ts →    Duration  2.55s (environment 47%, setup 21%, tests 13%, worker 9%, import 8%, transform 3%))
- Task 14: Ruling: ArenaScreen takes optional `clock` (now/schedule) and `onSim` props for tests and screenshots; arena CSS lives in app.css's components layer like every other screen; the pause menu reuses .pill/.pill-solar instead of a new primary button — cost if wrong: props/classes only.
Task 14: complete (commits 3dac8af..15311fb, tests: pnpm -C games/galaxy exec vitest run --project web apps/web/test/loop.test.ts apps/web/test/input.test.ts apps/web/test/arena.test.tsx →    Duration  2.08s (environment 57%, setup 24%, import 8%, transform 5%, tests 5%))
- Task 15: Ruling: the hangar describes relics with DEFAULT_CONTENT's tuning (HangarView carries no content) — labels and family/element/phenomenon never depend on tuning; only the "Potencia ×" number could drift if an admin retunes — cost if wrong: one approximate number on a label.
- Task 15: Ruling: the launch bar is sticky at the bottom (at 1280×720 the panels push it below the fold); `.hud` was taken by the wallet panel, so the arena's HUD root is `.arena-hud`; the browser test project dedupes React and pre-bundles React Query/Router with it (two copies of React broke hooks) — cost if wrong: CSS/config only.
Task 15: complete (commits 15311fb..8c54300, tests: pnpm -C games/galaxy exec vitest run --project web →              learn more: https://vitest.dev/guide/improving-performance#test-environments)
Task 16: Docker image built (16 s, cached layers; sim bundled into server dist) and smoke-tested against local Postgres: /galaxy/api/health → {"ok":true,"db":"up"}, /galaxy/incursion 200, CSP script-src 'self'.
Task 16: complete (commits 90e6859..639e4d1, tests: pnpm -C games/galaxy test → 92 files, 912 passed | 3 skipped; pgTAP 4839/4839; root TZ=UTC test:unit 5410/5410; e2e 19/19; Docker build + smoke OK)
Final review: opus subagent on review-145eecc..90e6859 (+639e4d1): 1 Critical, 5 Important, 9 Minor
Final: fixed C1 forged finish paid ~2·10^9 coins (flags never changed the payout) — shared 'una reclamación imposible se recorta…' (4 tests) + 'frenos del pago' (2) RED→GREEN; server 'una partida con banderas de trampa cobra solo la parte de morir', 'dos partidas a la vez no cobran dos veces el mismo tiempo real', 'ninguna partida cobra más que el techo por partida' RED→GREEN, suite 933/933 (+3 skipped)
Final: fixed I5 a 2.0–2.1 MB log gave 500 — 'entradas válidas de más de 2 MB → 400 bad_inputs, nunca 500' RED→GREEN, suite 933/933
Final: fixed I2 401/403/429 deleted the pending run and resends used up the finish limit — server 'reenviar un resultado ya cobrado no gasta el límite de envíos' + web 'un 401/403/429 al enviar el final no lo borra' RED→GREEN, suite 933/933
Final: fixed I1 result lost if the tab closed within 1.5 s of the end — arena 'al terminar, el resultado sale al momento para guardarlo' + hangar 'el resultado se guarda en cuanto acaba la partida…' RED→GREEN, suite 933/933
Final: fixed I3 focus lost while the stage loaded left the run playing under the pause menu — loop 'una pausa antes de arrancar se respeta' + arena 'perder el foco mientras carga la arena…' RED→GREEN, suite 933/933
Final: fixed I4 a gamepad could not choose a level-up — arena 'con mando: la cruceta y el stick mueven la selección de mejora y A la elige' RED→GREEN, suite 933/933
Final: fixed (re-graded Minor 5 → Important) a failed arena chunk blanked the app — hangar 'si la arena no carga, se dice y se ofrece recargar…' RED→GREEN, suite 933/933; e2e incursion.spec green after the pass
Final: Ruling: Minor 5 re-graded to Important — beta testers keep tabs open across PRE deploys, so a stale chunk right after a run starts is what they would get — cost if wrong: none beyond a small boundary
Final: Ruling: beyond the review's minimum, a per-run ceiling (runs.caps.runCoins 20 000 / runDust 10 000, live config, flag payout_cap) and one real-time window per account (a run overlapping a finished one only counts the time since that finish) — the residual forged-claim risk stays until M5 replays — cost if wrong: an exceptional legit run (≥15× the best calibration run) is capped and marked suspicious
Final: Ruling: too_fast, depth_vs_time, kills_rate, boss_kills and log_mismatch pay only the death share; loot_cap alone only clips — none of 8 calibrated bot runs raised a flag — cost if wrong: a legit run hit by a false positive is paid half
Final: Ruling: plausibility keeps the current content's layer length (no layer_seconds column) — layer-length retunes are rare admin actions — cost if wrong: runs in flight during such a retune may be clipped and flagged
Final: Ruling: calibration keeps the 40× median bound; an absolute DPS ceiling joins M3b-1's build simulation (GDD §8.6) — cost if wrong: a moderate balance regression goes unnoticed until M3b-1
Final: Ruling: (declined to judge) sprite, HUD and CSS quality — screenshots were reviewed in T13–T15 and the user reviews on PRE — cost if wrong: visual polish lands later
Final: Ruling: (declined to judge) balance numbers — live-config tuning, bot-calibrated (layer 2.6 in 19 min on average) — cost if wrong: a live-config retune
Final: Ruling: (declined to judge) cross-browser determinism — code-level discipline is enough until M5 replays verify runs — cost if wrong: M5 finds Firefox/Safari drift and fixes it then
Final: Ruling: (declined to judge) a reload mid-run loses that run — beforeunload warns and the run expires unpaid — cost if wrong: an accidental reload mid-run loses its loot
Final: Ruling: (declined to judge) PERKINS lines per browser, the 3 MB body parsed before the session check, the content stored in operations per start, an old start key returning the older run — all stand as designed (plan key, body limit, ~13.5 KB per start, M2b intent design) — cost if wrong: repeated radio lines on a new browser; up to 3 MB parsed per unauthenticated request; operations table growth
Final: minor (deferred): a full enemy pool when the layer ends never spawns the boss, so the run cannot extract (only after an admin retune of caps)
Final: minor (deferred): a full shots pool makes orbit/blade/drone shots respawn every tick and ignore their hit interval (deterministic)
Final: minor (deferred): a non-integer aim is used truncated but logged as automatic, so a replay could diverge (today's client sends integers)
Final: minor (deferred): the damage-number bitmap font is installed on every run and never uninstalled (warning + small texture leak)
Final: minor (deferred): xp {base 0, linear 0, quad 0} passes the content schema and loops forever
Final: minor (deferred): a refused loadout change (409) shows nothing
Final: minor (deferred): a quick second Enter on consecutive level-ups can pick from the new offer while the old one is on screen (10 Hz HUD)
Final: minor (deferred): recording tests with full pools, relics and manual aim (behaviour verified by the reviewer)
