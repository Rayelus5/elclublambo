# SDD ledger — plan: docs/superpowers/plans/2026-11-08-galaxy-m6d4-ficha-completa.md
Spec: games/galaxy/docs/GDD.md §16.1, §16.2.
Pre-flight: Task 2 consumes Task 1 shared schemas, AdminPlayer.progress and the six routes — consistent; Task 3 consumes Task 2 copy (read at write time).
Ruling: of «rasgos» only galaxy_type is chosen (the most visible trait; a full trait combination would need an unbounded seed search) and the seed field stays for an exact galaxy — cost if wrong: another field later.
Task 1: Ruling: pgTAP file is 997_galaxy_admin_progress (994 is taken) — cost if wrong: none.
Task 1: Ruling: the progress is its own endpoint GET /admin/players/:username/progress (AdminProgress), not a field of AdminPlayer — it needs the live config and the ranking; the player page stays light — cost if wrong: one more request on the tab.
Task 1: Ruling: gacha luck edits never ask the password (tuning counters, not an asset) — cost if wrong: an admin could lower luck without re-typing it (audited anyway).
Task 1: Ruling: lowering the refinery keeps its queue (no material destroyed); a queue above the new capacity just refines on and the player cannot load more until it drops — Review Focus 1 read as «no material lost» — cost if wrong: a queue larger than shown capacity for a while.
Task 1: Ruling: a Laboratorio node can be set even if its required parent is not (admin power); the antenna's level change applies to its whole uncollected window — cost if wrong: minor oddities after an admin edit.
Task 1: Ruling: a galaxy of a chosen type reuses generateGalaxy's featured-trait search (bounded by MAX_CANDIDATES like featured pulls) instead of a 4096-try loop; with a seed, the seed is the pull seed the candidates come from — cost if wrong: none.
Task 1: Ruling: galaxy_api gets DELETE on lab_nodes (new migration *_galaxy_lab_nodes_delete): taking a node back to 0 deletes its row (levels are 1–10). M4b-2's pgTAP 978 «never deletes them» was least privilege for the game and is updated — cost if wrong: none (the game still never deletes).
Task 1: the probe test's no-password attempt sent a variant level 2 no longer opens (a correct 400): fixed the test to send a valid lowering (variant null) → 401.
Task 1: one combined run showed 'desbloquear una sonda…' failing once; three reruns alone and one combined (86/86) passed — watch for a flake.
Task 1: complete (commits 24cf1e9..67b8035, tests: bash -c 'cd games/galaxy/apps/server && pnpm exec vitest run test/integration/admin-progress.test.ts test/integration/hangar.test.ts test/integration/probes.test.ts test/integration/social.test.ts' →    Duration  3.71s (tests 49%, import 36%, transform 14%))
Task 2: consulted ui-ux-pro-max (inline validation, error placement); DESIGN_SYSTEM §8 tervicies written.
Task 2: Ruling: ActionDialog fields gain an optional `initial` (the value now), so a change starts from the current level or counter — cost if wrong: none.
Task 2: Ruling: the tab renders its own ActionDialog and «Hecho» notice (ProgressTab.tsx) instead of reusing PlayerScreen's — keeps the page component smaller — cost if wrong: two notices could show if both are used in a row.
Task 2: the web test assumed number inputs (type=number); the panel's number fields are text with inputMode numeric → assertions read the string value.
Task 2: rendering at 1440 px: row headers inherited the column headers' dark sticky background and cells sat at the top beside their buttons → th[scope=row] without background, cells middle-aligned; the short machines table beside the long Laboratorio left a gap → machines and season stacked in the left column. No console errors.
Task 2: complete (commits 67b8035..9ac15ff, tests: bash -c 'cd games/galaxy && pnpm exec vitest run --project web apps/web/test/admin-progress.test.tsx apps/web/test/admin.test.tsx' →    Duration  5.76s (tests 65%, environment 17%, import 8%, setup 7%, transform 3%))
Task 3: e2e admin-progress.spec: 2 passed (setup + spec) on the first run (Playwright hang after, :8090 killed). DEPLOY_PRE step 26 written.
Task 3: complete (commits 9ac15ff..8e83c7c, tests: bash -c 'cd games/galaxy && pnpm exec vitest run --project web apps/web/test/admin-progress.test.tsx' →    Duration  5.63s (tests 68%, environment 15%, import 7%, setup 6%, transform 4%))
Final review: fresh opus reviewer — no Critical; 3 Important; 12 Minor; verdict "with fixes".
Final: fixed an admin luck edit on an account that never opened the Escáner removing its welcome luck for good — progress shows welcome on until gacha_accounts.welcome_granted_at, and a standard row made by the panel starts with it — test 'una cuenta que aún no ha escaneado conserva su suerte de bienvenida tras un cambio' RED→GREEN.
Final: fixed lowering a probe with a variant from the dialog failing with a vague 400 — the dialog sends the base weapon when the new level does not open the chosen one (hint says so) — web test 'bajar una sonda por debajo de su arma elegida la devuelve al arma base' RED→GREEN.
Final: fixed the flaky audit-order assertion — audits() orders by id.
Final: fixed (re-graded Minor→Important, overturning my Task 1 ruling: pity near the guarantee is value the player paid for; the plan says taking away asks the password) lowering gacha luck or turning welcome off without the password — decided against the row read under its lock — tests 'bajar la suerte o quitar la de bienvenida pide la contraseña' RED→GREEN, web luck test extended RED→GREEN; earlier luck tests now send the password.
Final: Ruling: ProgressTab.tsx was reformatted with prettier --single-quote --print-width 160 (no prettier config in the repo; the first default run had switched it to double quotes) — cost if wrong: formatting nits.
Final: minor (deferred): the password decision for probe/room/node edits reads «current» outside the lock (a race can write a lowering without the password; audited); web compares the clamped probe level while the server compares the raw one (a 401 without a password field, counting toward the 10 strikes).
Final: minor (deferred): the refinery can be set to 0 (shows broken but refines at level-1 speed and repairs for free); its minimum should be 1.
Final: minor (deferred): a queue above the new refinery capacity leaves aria-valuenow above aria-valuemax; setting the antenna to 0 drops up to 2 uncollected signals.
Final: minor (deferred): locking a probe can race a player choosing it (no shared lock); run start never checks unlock (pre-existing).
Final: minor (deferred): a banned or excluded player's season line reads «0 puntos, de ellos 100 de ajustes».
Final: minor (deferred): the season audit row has no before/after totals.
Final: minor (deferred): pity groups show raw ids («standard»); a group whose banner left the config shows a «Cambiar» that always answers 400.
Final: minor (deferred): action columns have empty headers (needs a visually hidden «Acciones»).
Final: minor (deferred): no shared unit test for probeStatus(…, granted) (covered by integration).
Final: minor (deferred): grantGalaxy's catch relabels every failure as galaxy_type_not_found.
Final: suites after the fix pass: unit+web 1369 passed (TZ=UTC), integration 355 passed (config.test excluded locally), pgTAP PASS, typecheck 0, lint 0; e2e admin-progress.spec rerun: 2 passed.
Merged: PR #59 → develop (merge ee87c3e) on green CI, 2026-11-08. PRE check pending (the owner turned the Cloudflare tunnel off).
PRE check (2026-11-08, tunnel back, deploy ee87c3e success) with e2e_pre_3e9567: progress API 401 without session and 403 to a player, /admin/jugadores → /galaxy, title screen loads, no CSP, no errors.
